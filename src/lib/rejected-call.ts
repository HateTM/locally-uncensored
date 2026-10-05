/**
 * What the model reads when the user said No to one of its tool calls.
 *
 * Gegenprobe 01.10.2026: after "No" the Code tab handed the model the bare
 * executor text "User rejected tool call", and Mistral answered that it had no
 * tools at all. The model has to know three things to carry on usefully: the
 * call did not run, its tools are still there, and repeating the same call is
 * the one thing that will not help. One sentence for Code and Agent.
 */
export const REJECTED_CALL_FOR_MODEL =
  'The user declined this tool call, so it did not run. All your tools are still available. ' +
  'Do not repeat the same call: continue another way, or ask the user what they want instead.'
