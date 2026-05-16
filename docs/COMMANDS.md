# Command Reference

## `relay init`

Initializes `.relay` in the current repository.

## `relay session start`

Creates a session anchored to the current git SHA.

## `relay session status`

Prints current session metadata.

## `relay ask <prompt>`

Builds a deterministic three-zone prompt payload and prints it.

Future behavior: route the payload to a configured provider.

## `relay diff`

Prints the git diff since the current session base SHA.

## `relay cache fingerprint`

Prints the hash of the static block plus state layer.

## `relay cache inspect`

Prints cache-relevant diagnostics.

## `relay cache warm`

Placeholder for future provider cache warming.

## `relay tokens estimate [text...]`

Estimates token count for provided text.

## `relay tokens budget`

Prints default token budget configuration.

## `relay gc status`

Prints token garbage collection configuration.

## `relay gc run`

Placeholder for context compaction.

## `relay gc preview`

Prints current semantic state.

## `relay gc restore`

Placeholder for restoring a prior compacted state.
