//! Which graphics cards the LU Engine offloads to.
//!
//! The finding: the GPU pick in Settings, Hardware never reached the LU
//! Engine. `gpu::apply_gpu_env` sets `CUDA_VISIBLE_DEVICES`,
//! `HIP_VISIBLE_DEVICES` and `ONEAPI_DEVICE_SELECTOR`, which is right for
//! Ollama and ComfyUI, but the Windows and Linux sidecar is a Vulkan build
//! (`-DGGML_VULKAN=ON` in scripts/build-llama.sh, no CUDA, no HIP), and
//! ggml-vulkan reads none of those. It took every dedicated card it could see
//! and split the model across them, while `plan_offload` sized the layer count
//! against the single biggest card, whichever one the user had picked. A user
//! who picked the smaller of two cards got a full offload planned against the
//! bigger one, a start that died, and a retry on the processor.
//!
//! The engine's own language for a card is its ggml device name (`Vulkan0`),
//! passed as `--device`. The same binary prints those names with
//! `--list-devices` (common/arg.cpp in the pinned llama.cpp):
//!
//! ```text
//! Available devices:
//!   Vulkan0: NVIDIA GeForce RTX 4090 (24564 MiB, 23012 MiB free)
//!   Vulkan1: NVIDIA GeForce RTX 3060 (12288 MiB, 11800 MiB free)
//! ```
//!
//! That listing carries a name and a size, not a PCI address or a UUID, so the
//! pick is translated by what the vendor tool and Vulkan agree on: the card's
//! name and its memory. Where that cannot tell two cards apart (two of the same
//! model, only one of them picked), nothing is pinned and the log says why,
//! rather than guessing at an enumeration order nobody here can see.

use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::gpu::{DetectedGpu, GpuSelection};

/// `--list-devices` loads every backend and asks each card for its memory
/// budget, then exits. Seconds on a cold driver, never minutes.
const LIST_TIMEOUT: Duration = Duration::from_secs(15);

/// How long a resolved pin is reused for the spawn attempts of one start.
/// The planning step refreshes it on every start, so this only spares the
/// retry and the sanity restarts a second probe.
const PIN_TTL: Duration = Duration::from_secs(120);

/// One device as `llama-server --list-devices` prints it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EngineDevice {
    /// The ggml device name `--device` takes (`Vulkan0`).
    pub name: String,
    /// What the driver calls the card.
    pub description: String,
    pub total_mib: u64,
    pub free_mib: u64,
}

/// Read the device lines out of `--list-devices`. Lines that do not have the
/// exact shape are skipped, so a header, a driver warning or a future extra
/// line costs nothing.
pub(crate) fn parse_list_devices(out: &str) -> Vec<EngineDevice> {
    out.lines().filter_map(parse_device_line).collect()
}

fn parse_device_line(line: &str) -> Option<EngineDevice> {
    let (name, rest) = line.trim().split_once(": ")?;
    if name.is_empty() || name.contains(char::is_whitespace) {
        return None;
    }
    let rest = rest.strip_suffix(" MiB free)")?;
    // The LAST " (" opens the memory part; a description can carry its own
    // parentheses ("AMD Radeon RX 7900 XTX (RADV NAVI31)").
    let open = rest.rfind(" (")?;
    let description = rest[..open].trim().to_string();
    let (total, free) = rest[open + 2..].split_once(", ")?;
    Some(EngineDevice {
        name: name.to_string(),
        description,
        total_mib: total.strip_suffix(" MiB")?.trim().parse().ok()?,
        free_mib: free.trim().parse().ok()?,
    })
}

/// A card name reduced to what two tools agree on: lower case, letters and
/// digits only, without the (R)/(TM) marks, and without a trailing driver tag
/// in parentheses ("(RADV NAVI31)").
fn card_key(name: &str) -> String {
    let mut s = name.trim().to_lowercase();
    if s.ends_with(')') {
        if let Some(open) = s.rfind(" (") {
            s.truncate(open);
        }
    }
    s.replace("(r)", "")
        .replace("(tm)", "")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

/// Same size within a GiB or an eighth, whichever is larger: Vulkan reports
/// the device-local heap, which sits a little under what the vendor tool calls
/// the card's memory. Unknown on either side is not a mismatch.
fn same_memory(card: &DetectedGpu, dev: &EngineDevice) -> bool {
    match card.memory_mib {
        Some(m) if dev.total_mib > 0 => m.abs_diff(dev.total_mib) <= (m / 8).max(1024),
        _ => true,
    }
}

/// The engine devices that could be this card: the same name exactly, and
/// only when no device has exactly its name, a name that contains the other
/// (so an "RTX 3090" never claims an "RTX 3090 Ti" sitting next to it).
fn candidates(card: &DetectedGpu, devices: &[EngineDevice]) -> Vec<usize> {
    let key = card_key(&card.name);
    if key.is_empty() {
        return Vec::new();
    }
    let fits = |i: &usize| same_memory(card, &devices[*i]);
    let exact: Vec<usize> = (0..devices.len())
        .filter(|i| card_key(&devices[*i].description) == key)
        .filter(fits)
        .collect();
    if !exact.is_empty() {
        return exact;
    }
    (0..devices.len())
        .filter(|i| {
            let d = card_key(&devices[*i].description);
            !d.is_empty() && (d.contains(&key) || key.contains(&d))
        })
        .filter(fits)
        .collect()
}

/// Translate the picked cards into engine devices, in the engine's order.
///
/// Cards that look alike form one group; a group is only pinned when the pick
/// covers every card in it, because then the order inside the group does not
/// matter. Picking one of two identical cards is refused with a reason.
pub(crate) fn match_selection(
    picked: &[DetectedGpu],
    devices: &[EngineDevice],
) -> Result<Vec<EngineDevice>, String> {
    if picked.is_empty() {
        return Err("no card is picked".to_string());
    }
    let mut groups: Vec<(Vec<usize>, Vec<&DetectedGpu>)> = Vec::new();
    for card in picked {
        let found = candidates(card, devices);
        if found.is_empty() {
            return Err(format!(
                "the engine lists no device that looks like {} (it lists: {})",
                card.name,
                listed(devices)
            ));
        }
        match groups.iter_mut().find(|(g, _)| *g == found) {
            Some((_, cards)) => cards.push(card),
            None => groups.push((found, vec![card])),
        }
    }
    let mut chosen: Vec<usize> = Vec::new();
    for (found, cards) in &groups {
        if cards.len() != found.len() {
            return Err(format!(
                "{} card(s) named {} are picked, but the engine sees {} device(s) it cannot tell apart from them, so it cannot know which one is meant",
                cards.len(),
                cards[0].name,
                found.len()
            ));
        }
        for i in found {
            if chosen.contains(i) {
                return Err(format!("two picked cards both look like {}", devices[*i].description));
            }
            chosen.push(*i);
        }
    }
    chosen.sort_unstable();
    Ok(chosen.into_iter().map(|i| devices[i].clone()).collect())
}

fn listed(devices: &[EngineDevice]) -> String {
    if devices.is_empty() {
        return "nothing".to_string();
    }
    devices
        .iter()
        .map(|d| format!("{} {}", d.name, d.description))
        .collect::<Vec<_>>()
        .join(", ")
}

/// The value for `--device`.
pub(crate) fn device_list(devices: &[EngineDevice]) -> String {
    devices.iter().map(|d| d.name.as_str()).collect::<Vec<_>>().join(",")
}

/// The argv with `--device` appended, unless it already names one.
pub(crate) fn with_device(args: &[String], devices: &str) -> Vec<String> {
    let mut out = args.to_vec();
    if !args.iter().any(|a| a == "--device" || a == "-dev") {
        out.push("--device".to_string());
        out.push(devices.to_string());
    }
    out
}

// ── Runtime: the probes and the pin cache ───────────────────────────────────

/// The cards the Hardware pick names, from the same detection the picker
/// shows. `Ok(empty)` is "auto": nothing picked, nothing to pin.
fn picked_cards(sel: &GpuSelection) -> Result<Vec<DetectedGpu>, String> {
    if sel.indices.is_empty() {
        return Ok(Vec::new());
    }
    let all = if sel.vendor == "nvidia" {
        super::gpu::detect_nvidia()
    } else {
        super::gpu::detect_gpus()?
    };
    let picked: Vec<DetectedGpu> = all
        .into_iter()
        .filter(|g| g.vendor == sel.vendor && sel.indices.contains(&g.index))
        .collect();
    if picked.len() != sel.indices.len() {
        return Err(format!(
            "the picked {} card(s) {:?} are not all detected right now",
            sel.vendor, sel.indices
        ));
    }
    Ok(picked)
}

fn list_devices(binary: &Path, prepare: &dyn Fn(&mut Command)) -> Option<Vec<EngineDevice>> {
    let mut cmd = Command::new(binary);
    cmd.arg("--list-devices");
    prepare(&mut cmd);
    let out = super::shell::output_bounded(cmd, LIST_TIMEOUT)?;
    Some(parse_list_devices(&out))
}

/// Resolve the pick against a fresh listing. `Ok(None)` is "auto".
fn resolve(
    sel: &GpuSelection,
    binary: &Path,
    prepare: &dyn Fn(&mut Command),
) -> Result<Option<Vec<EngineDevice>>, String> {
    let picked = picked_cards(sel)?;
    if picked.is_empty() {
        return Ok(None);
    }
    let devices = list_devices(binary, prepare)
        .ok_or_else(|| "llama-server --list-devices did not answer".to_string())?;
    match_selection(&picked, &devices).map(Some)
}

struct CachedPin {
    key: String,
    at: Instant,
    /// `None` = leave the engine on its default devices.
    device: Option<String>,
}

static PIN: Mutex<Option<CachedPin>> = Mutex::new(None);

fn pin_key(sel: &GpuSelection, binary: &Path) -> String {
    format!("{}|{}|{:?}", binary.display(), sel.vendor, sel.indices)
}

fn remember(key: String, device: Option<String>) {
    if let Ok(mut pin) = PIN.lock() {
        *pin = Some(CachedPin { key, at: Instant::now(), device });
    }
}

fn log_outcome(sel: &GpuSelection, outcome: &Result<Option<Vec<EngineDevice>>, String>) {
    match outcome {
        Ok(Some(devices)) => tracing::info!(
            target: "engine",
            vendor = %sel.vendor,
            picked = ?sel.indices,
            devices = %listed(devices),
            "the Hardware pick reaches the LU Engine as --device {}",
            device_list(devices)
        ),
        Ok(None) => {}
        Err(why) => tracing::warn!(
            target: "engine",
            vendor = %sel.vendor,
            picked = ?sel.indices,
            reason = %why,
            "the Hardware pick could not be translated for the LU Engine, it uses its default devices"
        ),
    }
}

/// For the layer plan: the picked devices with their free memory measured
/// just now, or `None` (auto, macOS, or a pick that could not be translated).
/// Refreshes the pin the spawn attempts of this start then reuse.
pub(crate) fn picked_devices_now(
    sel: &GpuSelection,
    binary: &Path,
    prepare: &dyn Fn(&mut Command),
) -> Option<Vec<EngineDevice>> {
    if cfg!(target_os = "macos") {
        return None;
    }
    let outcome = resolve(sel, binary, prepare);
    log_outcome(sel, &outcome);
    let devices = outcome.ok().flatten();
    remember(pin_key(sel, binary), devices.as_deref().map(device_list));
    devices
}

/// For a spawn: the `--device` value, or `None` to leave the engine on its
/// default devices. Reuses the pin the plan resolved moments ago; a spawn
/// that no plan preceded (the embeddings server, a restore) resolves it here.
pub(crate) fn device_pin(
    sel: &GpuSelection,
    binary: &Path,
    prepare: &dyn Fn(&mut Command),
) -> Option<String> {
    if cfg!(target_os = "macos") || sel.indices.is_empty() {
        return None;
    }
    let key = pin_key(sel, binary);
    if let Ok(pin) = PIN.lock() {
        if let Some(p) = pin.as_ref().filter(|p| p.key == key && p.at.elapsed() < PIN_TTL) {
            return p.device.clone();
        }
    }
    let outcome = resolve(sel, binary, prepare);
    log_outcome(sel, &outcome);
    let device = outcome.ok().flatten().as_deref().map(device_list);
    remember(key, device.clone());
    device
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(index: u32, vendor: &str, name: &str, mib: Option<u64>) -> DetectedGpu {
        DetectedGpu {
            index,
            vendor: vendor.into(),
            name: name.into(),
            memory_mib: mib,
            source: "test".into(),
            note: None,
            note_severity: None,
            arch: None,
            uuid: None,
        }
    }

    fn dev(name: &str, description: &str, total: u64, free: u64) -> EngineDevice {
        EngineDevice { name: name.into(), description: description.into(), total_mib: total, free_mib: free }
    }

    #[test]
    fn the_listing_is_read_line_by_line_and_skips_what_is_not_a_device() {
        let out = "ggml_vulkan: Found 2 Vulkan devices:\n\
                   Available devices:\n  \
                   Vulkan0: NVIDIA GeForce RTX 4090 (24564 MiB, 23012 MiB free)\n  \
                   Vulkan1: AMD Radeon RX 7900 XTX (RADV NAVI31) (24560 MiB, 24000 MiB free)\n\
                   some warning: nothing to see (here)\n";
        assert_eq!(
            parse_list_devices(out),
            vec![
                dev("Vulkan0", "NVIDIA GeForce RTX 4090", 24564, 23012),
                dev("Vulkan1", "AMD Radeon RX 7900 XTX (RADV NAVI31)", 24560, 24000),
            ]
        );
        assert!(parse_list_devices("").is_empty());
        assert!(parse_list_devices("Available devices:\n").is_empty());
    }

    #[test]
    fn picking_the_smaller_card_pins_that_card_and_not_the_bigger_one() {
        // The case that sent the engine to the processor: two cards, the
        // smaller one picked. The engine lists them in its own order.
        let devices = [
            dev("Vulkan0", "NVIDIA GeForce RTX 4090", 24564, 23000),
            dev("Vulkan1", "NVIDIA GeForce RTX 3060", 12288, 11800),
        ];
        let picked = [card(1, "nvidia", "NVIDIA GeForce RTX 3060", Some(12288))];
        let got = match_selection(&picked, &devices).unwrap();
        assert_eq!(device_list(&got), "Vulkan1");
        assert_eq!(got[0].free_mib, 11800);
    }

    #[test]
    fn the_engine_order_wins_not_the_vendor_order() {
        let devices = [
            dev("Vulkan0", "NVIDIA GeForce RTX 3060", 12288, 11800),
            dev("Vulkan1", "NVIDIA GeForce RTX 4090", 24564, 23000),
        ];
        let picked = [
            card(0, "nvidia", "NVIDIA GeForce RTX 4090", Some(24564)),
            card(1, "nvidia", "NVIDIA GeForce RTX 3060", Some(12288)),
        ];
        assert_eq!(device_list(&match_selection(&picked, &devices).unwrap()), "Vulkan0,Vulkan1");
    }

    #[test]
    fn one_of_two_identical_cards_is_refused_both_of_them_are_pinned() {
        let devices = [
            dev("Vulkan0", "NVIDIA GeForce RTX 3090", 24576, 24000),
            dev("Vulkan1", "NVIDIA GeForce RTX 3090", 24576, 24000),
        ];
        let one = [card(1, "nvidia", "NVIDIA GeForce RTX 3090", Some(24576))];
        let why = match_selection(&one, &devices).unwrap_err();
        assert!(why.contains("cannot know which one"), "{why}");
        let both = [
            card(0, "nvidia", "NVIDIA GeForce RTX 3090", Some(24576)),
            card(1, "nvidia", "NVIDIA GeForce RTX 3090", Some(24576)),
        ];
        assert_eq!(device_list(&match_selection(&both, &devices).unwrap()), "Vulkan0,Vulkan1");
    }

    #[test]
    fn a_3090_does_not_claim_the_3090_ti_next_to_it() {
        let devices = [
            dev("Vulkan0", "NVIDIA GeForce RTX 3090 Ti", 24564, 24000),
            dev("Vulkan1", "NVIDIA GeForce RTX 3090", 24576, 24000),
        ];
        let picked = [card(0, "nvidia", "NVIDIA GeForce RTX 3090", Some(24576))];
        assert_eq!(device_list(&match_selection(&picked, &devices).unwrap()), "Vulkan1");
    }

    #[test]
    fn a_driver_tag_and_trademark_marks_do_not_stop_a_match() {
        let devices = [
            dev("Vulkan0", "Intel(R) Arc(TM) A770 Graphics (DG2)", 16032, 15000),
            dev("Vulkan1", "AMD Radeon RX 7900 XTX (RADV NAVI31)", 24560, 24000),
        ];
        let intel = [card(0, "intel", "Intel Arc A770 Graphics", None)];
        assert_eq!(device_list(&match_selection(&intel, &devices).unwrap()), "Vulkan0");
        let amd = [card(0, "amd", "AMD Radeon RX 7900 XTX", Some(24560))];
        assert_eq!(device_list(&match_selection(&amd, &devices).unwrap()), "Vulkan1");
    }

    #[test]
    fn a_card_the_engine_does_not_list_is_named_in_the_refusal() {
        let devices = [dev("Vulkan0", "NVIDIA GeForce RTX 4090", 24564, 23000)];
        let picked = [card(1, "nvidia", "NVIDIA GeForce RTX 3060", Some(12288))];
        let why = match_selection(&picked, &devices).unwrap_err();
        assert!(why.contains("RTX 3060") && why.contains("Vulkan0"), "{why}");
        assert!(match_selection(&[], &devices).is_err());
    }

    #[test]
    fn the_same_name_with_a_different_size_is_not_the_same_card() {
        // An 8 GB and a 16 GB card sold under one name.
        let devices = [
            dev("Vulkan0", "AMD Radeon RX 7600", 8176, 8000),
            dev("Vulkan1", "AMD Radeon RX 7600", 16368, 16000),
        ];
        let picked = [card(0, "amd", "AMD Radeon RX 7600", Some(16384))];
        assert_eq!(device_list(&match_selection(&picked, &devices).unwrap()), "Vulkan1");
    }

    #[test]
    fn the_device_flag_is_appended_once() {
        let args = vec!["-m".to_string(), "/m.gguf".to_string()];
        let pinned = with_device(&args, "Vulkan1");
        assert_eq!(pinned, vec!["-m", "/m.gguf", "--device", "Vulkan1"]);
        assert_eq!(with_device(&pinned, "Vulkan0"), pinned);
    }
}
