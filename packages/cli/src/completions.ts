export const BASH_COMPLETION = `
_relay() {
  local cur prev
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  local top_cmds="init session ask diff doctor mcp cache tokens gc context audit usage savings completion"

  # Enum completions for specific option flags
  case "$prev" in
    --diff-mode)
      COMPREPLY=( $(compgen -W "full summarized auto" -- "$cur") )
      return ;;
    --event)
      COMPREPLY=( $(compgen -W "ask session_start session_end gc_run anomaly budget_warning budget_blocked" -- "$cur") )
      return ;;
    --provider|--model|--cwd|--tail|--session|--input|--cached-input|--cache-creation|--output|--input-cost-per-million|--cached-input-cost-per-million|--cache-creation-cost-per-million|--output-cost-per-million|--expected-cache-hit-rate)
      return ;;
  esac

  local cmd="\${COMP_WORDS[1]}"
  local subcmd="\${COMP_WORDS[2]}"

  case "$cmd" in
    session)
      if [[ $COMP_CWORD -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "start status end" -- "$cur") )
      elif [[ "$subcmd" == "end" && "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "--reset-memory" -- "$cur") )
      fi
      return ;;
    ask)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "--provider --model --dry-run --staged --diff-mode --include-timestamp --measure" -- "$cur") )
      fi
      return ;;
    diff)
      COMPREPLY=( $(compgen -W "--staged" -- "$cur") )
      return ;;
    mcp)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "--cwd" -- "$cur") )
      fi
      return ;;
    cache)
      if [[ $COMP_CWORD -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "fingerprint inspect warm" -- "$cur") )
      elif [[ "$subcmd" == "inspect" && "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "--input-cost-per-million --cached-input-cost-per-million --expected-cache-hit-rate --use-recorded-history" -- "$cur") )
      elif [[ "$subcmd" == "warm" && "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "--provider --dry-run" -- "$cur") )
      fi
      return ;;
    tokens)
      if [[ $COMP_CWORD -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "estimate budget inspect" -- "$cur") )
      fi
      return ;;
    gc)
      if [[ $COMP_CWORD -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "status run preview restore" -- "$cur") )
      fi
      return ;;
    context)
      if [[ $COMP_CWORD -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "inspect build" -- "$cur") )
      fi
      return ;;
    audit)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "--tail --event --session --json" -- "$cur") )
      fi
      return ;;
    usage)
      if [[ $COMP_CWORD -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "record" -- "$cur") )
      elif [[ "$subcmd" == "record" && "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "--input --cached-input --cache-creation --output --session" -- "$cur") )
      fi
      return ;;
    savings)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "--input-cost-per-million --cached-input-cost-per-million --cache-creation-cost-per-million --output-cost-per-million --session --json" -- "$cur") )
      fi
      return ;;
    completion)
      if [[ $COMP_CWORD -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )
      fi
      return ;;
  esac

  # Default: top-level commands
  if [[ $COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$top_cmds" -- "$cur") )
  fi
}
complete -F _relay relay
`.trimStart();

export const ZSH_COMPLETION = `
#compdef relay

_relay() {
  local state line
  typeset -A opt_args

  local -a top_commands
  top_commands=(
    'init:Initialize Relay in the current repository'
    'session:Manage Relay sessions'
    'ask:Build a cache-optimized prompt payload'
    'diff:Show git diff since current session base SHA'
    'doctor:Check workspace readiness'
    'mcp:Run Relay as a read-only MCP context server'
    'cache:Inspect deterministic prompt-cache metadata'
    'tokens:Estimate and inspect local token usage'
    'gc:Manage token garbage collection'
    'context:Inspect context construction state'
    'audit:Inspect the structured audit log'
    'usage:Record and inspect provider token usage'
    'savings:Report measured and projected cache savings'
    'completion:Print shell completion script'
  )

  _arguments -C \\
    '(-h --help)'{-h,--help}'[Show help]' \\
    '(-V --version)'{-V,--version}'[Show version]' \\
    '1: :->command' \\
    '*:: :->args'

  case $state in
    command)
      _describe 'relay command' top_commands ;;
    args)
      case $line[1] in
        session)
          local -a session_cmds
          session_cmds=('start:Start a git-anchored Relay session' 'status:Show current session metadata' 'end:End the current session')
          _arguments '1: :->subcmd' '*:: :->subcmd_args'
          case $state in
            subcmd) _describe 'session command' session_cmds ;;
            subcmd_args)
              case $line[1] in
                end) _arguments '--reset-memory[Also reset raw history and semantic state]' ;;
              esac ;;
          esac ;;
        ask)
          _arguments \\
            '--provider[Route through a configured provider]:provider name:' \\
            '--model[Model name for token cost estimation]:model:' \\
            '--dry-run[Print command without executing]' \\
            '--staged[Use staged diff instead of full session diff]' \\
            '--diff-mode[Diff rendering mode]:mode:(full summarized auto)' \\
            '--include-timestamp[Include ISO timestamp in dynamic input zone]' \\
            '--measure[Capture provider usage for measured savings]' \\
            '1:prompt:' ;;
        diff)
          _arguments '--staged[Show staged diff instead of session diff]' ;;
        mcp)
          _arguments '--cwd[Project directory]:directory:_directories' ;;
        cache)
          local -a cache_cmds
          cache_cmds=('fingerprint:Print current prefix hash' 'inspect:Inspect cache-relevant prefix details' 'warm:Send a stable prefix-shaped payload to a provider')
          _arguments '1: :->subcmd' '*:: :->subcmd_args'
          case $state in
            subcmd) _describe 'cache command' cache_cmds ;;
            subcmd_args)
              case $line[1] in
                inspect)
                  _arguments \\
                    '--input-cost-per-million[Input token cost per million]:number:' \\
                    '--cached-input-cost-per-million[Cached input token cost per million]:number:' \\
                    '--expected-cache-hit-rate[Expected prefix cache hit rate 0-1]:number:' \\
                    '--use-recorded-history[Use measured prefix-stability rate from audit log]' ;;
                warm)
                  _arguments \\
                    '--provider[Route through a configured provider]:provider name:' \\
                    '--dry-run[Print command without executing]' ;;
              esac ;;
          esac ;;
        tokens)
          local -a tok_cmds
          tok_cmds=('estimate:Estimate tokens for text' 'budget:Show current token budget' 'inspect:Show zone-by-zone token breakdown')
          _arguments '1: :->subcmd'
          case $state in
            subcmd) _describe 'tokens command' tok_cmds ;;
          esac ;;
        gc)
          local -a gc_cmds
          gc_cmds=('status:Show GC configuration' 'run:Compact session history' 'preview:Preview compacted state' 'restore:Roll back to previous snapshot')
          _arguments '1: :->subcmd'
          case $state in
            subcmd) _describe 'gc command' gc_cmds ;;
          esac ;;
        context)
          local -a ctx_cmds
          ctx_cmds=('inspect:Print context construction diagnostics' 'build:Scaffold hierarchical context files')
          _arguments '1: :->subcmd'
          case $state in
            subcmd) _describe 'context command' ctx_cmds ;;
          esac ;;
        audit)
          _arguments \\
            '--tail[Show last N entries]:number:' \\
            '--event[Filter by event type]:event:(ask session_start session_end gc_run anomaly budget_warning budget_blocked)' \\
            '--session[Filter by session ID]:session id:' \\
            '--json[Output raw NDJSON]' ;;
        usage)
          local -a usage_cmds
          usage_cmds=('record:Manually record measured provider token usage')
          _arguments '1: :->subcmd' '*:: :->subcmd_args'
          case $state in
            subcmd) _describe 'usage command' usage_cmds ;;
            subcmd_args)
              case $line[1] in
                record)
                  _arguments \\
                    '--input[Full-price input tokens billed]:number:' \\
                    '--cached-input[Cache-read input tokens]:number:' \\
                    '--cache-creation[Cache-creation tokens]:number:' \\
                    '--output[Output tokens]:number:' \\
                    '--session[Session id]:session id:' ;;
              esac ;;
          esac ;;
        savings)
          _arguments \\
            '--input-cost-per-million[Full-price input token cost per million]:number:' \\
            '--cached-input-cost-per-million[Cache-read input token cost per million]:number:' \\
            '--cache-creation-cost-per-million[Cache-write token cost per million]:number:' \\
            '--output-cost-per-million[Output token cost per million]:number:' \\
            '--session[Limit report to one session]:session id:' \\
            '--json[Emit JSON]' ;;
        completion)
          _arguments '1:shell:(bash zsh fish)' ;;
      esac ;;
  esac
}

_relay "$@"
`.trimStart();

export const FISH_COMPLETION = `
# relay shell completion for fish

complete -c relay -f

# Top-level commands
complete -c relay -n "not __fish_seen_subcommand_from init session ask diff doctor mcp cache tokens gc context audit usage savings completion" -a "init" -d "Initialize Relay in the current repository"
complete -c relay -n "not __fish_seen_subcommand_from init session ask diff doctor mcp cache tokens gc context audit usage savings completion" -a "session" -d "Manage Relay sessions"
complete -c relay -n "not __fish_seen_subcommand_from init session ask diff doctor mcp cache tokens gc context audit usage savings completion" -a "ask" -d "Build a cache-optimized prompt payload"
complete -c relay -n "not __fish_seen_subcommand_from init session ask diff doctor mcp cache tokens gc context audit usage savings completion" -a "diff" -d "Show git diff since current session base SHA"
complete -c relay -n "not __fish_seen_subcommand_from init session ask diff doctor mcp cache tokens gc context audit usage savings completion" -a "doctor" -d "Check workspace readiness"
complete -c relay -n "not __fish_seen_subcommand_from init session ask diff doctor mcp cache tokens gc context audit usage savings completion" -a "mcp" -d "Run Relay as a read-only MCP context server"
complete -c relay -n "not __fish_seen_subcommand_from init session ask diff doctor mcp cache tokens gc context audit usage savings completion" -a "cache" -d "Inspect deterministic prompt-cache metadata"
complete -c relay -n "not __fish_seen_subcommand_from init session ask diff doctor mcp cache tokens gc context audit usage savings completion" -a "tokens" -d "Estimate and inspect local token usage"
complete -c relay -n "not __fish_seen_subcommand_from init session ask diff doctor mcp cache tokens gc context audit usage savings completion" -a "gc" -d "Manage token garbage collection"
complete -c relay -n "not __fish_seen_subcommand_from init session ask diff doctor mcp cache tokens gc context audit usage savings completion" -a "context" -d "Inspect context construction state"
complete -c relay -n "not __fish_seen_subcommand_from init session ask diff doctor mcp cache tokens gc context audit usage savings completion" -a "audit" -d "Inspect the structured audit log"
complete -c relay -n "not __fish_seen_subcommand_from init session ask diff doctor mcp cache tokens gc context audit usage savings completion" -a "usage" -d "Record and inspect provider token usage"
complete -c relay -n "not __fish_seen_subcommand_from init session ask diff doctor mcp cache tokens gc context audit usage savings completion" -a "savings" -d "Report measured and projected cache savings"
complete -c relay -n "not __fish_seen_subcommand_from init session ask diff doctor mcp cache tokens gc context audit usage savings completion" -a "completion" -d "Print shell completion script"

# session subcommands
complete -c relay -n "__fish_seen_subcommand_from session; and not __fish_seen_subcommand_from start status end" -a "start" -d "Start a git-anchored Relay session"
complete -c relay -n "__fish_seen_subcommand_from session; and not __fish_seen_subcommand_from start status end" -a "status" -d "Show current session metadata"
complete -c relay -n "__fish_seen_subcommand_from session; and not __fish_seen_subcommand_from start status end" -a "end" -d "End the current session"
complete -c relay -n "__fish_seen_subcommand_from session end" -l reset-memory -d "Also reset raw history and semantic state"

# ask options
complete -c relay -n "__fish_seen_subcommand_from ask" -l provider -d "Route through a configured provider" -r
complete -c relay -n "__fish_seen_subcommand_from ask" -l model -d "Model name for token cost estimation" -r
complete -c relay -n "__fish_seen_subcommand_from ask" -l dry-run -d "Print command without executing"
complete -c relay -n "__fish_seen_subcommand_from ask" -l staged -d "Use staged diff instead of full session diff"
complete -c relay -n "__fish_seen_subcommand_from ask" -l diff-mode -d "Diff rendering mode" -r -a "full summarized auto"
complete -c relay -n "__fish_seen_subcommand_from ask" -l include-timestamp -d "Include ISO timestamp in dynamic input zone"
complete -c relay -n "__fish_seen_subcommand_from ask" -l measure -d "Capture provider usage for measured savings"

# diff options
complete -c relay -n "__fish_seen_subcommand_from diff" -l staged -d "Show staged diff instead of session diff"

# mcp options
complete -c relay -n "__fish_seen_subcommand_from mcp" -l cwd -d "Project directory" -r

# cache subcommands
complete -c relay -n "__fish_seen_subcommand_from cache; and not __fish_seen_subcommand_from fingerprint inspect warm" -a "fingerprint" -d "Print current prefix hash"
complete -c relay -n "__fish_seen_subcommand_from cache; and not __fish_seen_subcommand_from fingerprint inspect warm" -a "inspect" -d "Inspect cache-relevant prefix details"
complete -c relay -n "__fish_seen_subcommand_from cache; and not __fish_seen_subcommand_from fingerprint inspect warm" -a "warm" -d "Send a stable prefix-shaped payload to a provider"
complete -c relay -n "__fish_seen_subcommand_from cache inspect" -l input-cost-per-million -d "Input token cost per million" -r
complete -c relay -n "__fish_seen_subcommand_from cache inspect" -l cached-input-cost-per-million -d "Cached input token cost per million" -r
complete -c relay -n "__fish_seen_subcommand_from cache inspect" -l expected-cache-hit-rate -d "Expected prefix cache hit rate 0-1" -r
complete -c relay -n "__fish_seen_subcommand_from cache inspect" -l use-recorded-history -d "Use measured prefix-stability rate from audit log"
complete -c relay -n "__fish_seen_subcommand_from cache warm" -l provider -d "Route through a configured provider" -r
complete -c relay -n "__fish_seen_subcommand_from cache warm" -l dry-run -d "Print command without executing"

# tokens subcommands
complete -c relay -n "__fish_seen_subcommand_from tokens; and not __fish_seen_subcommand_from estimate budget inspect" -a "estimate" -d "Estimate tokens for text"
complete -c relay -n "__fish_seen_subcommand_from tokens; and not __fish_seen_subcommand_from estimate budget inspect" -a "budget" -d "Show current token budget"
complete -c relay -n "__fish_seen_subcommand_from tokens; and not __fish_seen_subcommand_from estimate budget inspect" -a "inspect" -d "Show zone-by-zone token breakdown"

# gc subcommands
complete -c relay -n "__fish_seen_subcommand_from gc; and not __fish_seen_subcommand_from status run preview restore" -a "status" -d "Show GC configuration"
complete -c relay -n "__fish_seen_subcommand_from gc; and not __fish_seen_subcommand_from status run preview restore" -a "run" -d "Compact session history"
complete -c relay -n "__fish_seen_subcommand_from gc; and not __fish_seen_subcommand_from status run preview restore" -a "preview" -d "Preview compacted state"
complete -c relay -n "__fish_seen_subcommand_from gc; and not __fish_seen_subcommand_from status run preview restore" -a "restore" -d "Roll back to previous snapshot"

# context subcommands
complete -c relay -n "__fish_seen_subcommand_from context; and not __fish_seen_subcommand_from inspect build" -a "inspect" -d "Print context construction diagnostics"
complete -c relay -n "__fish_seen_subcommand_from context; and not __fish_seen_subcommand_from inspect build" -a "build" -d "Scaffold hierarchical context files"

# audit options
complete -c relay -n "__fish_seen_subcommand_from audit" -l tail -d "Show last N entries" -r
complete -c relay -n "__fish_seen_subcommand_from audit" -l event -d "Filter by event type" -r -a "ask session_start session_end gc_run anomaly budget_warning budget_blocked"
complete -c relay -n "__fish_seen_subcommand_from audit" -l session -d "Filter by session ID" -r
complete -c relay -n "__fish_seen_subcommand_from audit" -l json -d "Output raw NDJSON"

# usage subcommands
complete -c relay -n "__fish_seen_subcommand_from usage; and not __fish_seen_subcommand_from record" -a "record" -d "Manually record measured provider token usage"
complete -c relay -n "__fish_seen_subcommand_from usage record" -l input -d "Full-price input tokens billed" -r
complete -c relay -n "__fish_seen_subcommand_from usage record" -l cached-input -d "Cache-read input tokens" -r
complete -c relay -n "__fish_seen_subcommand_from usage record" -l cache-creation -d "Cache-creation tokens" -r
complete -c relay -n "__fish_seen_subcommand_from usage record" -l output -d "Output tokens" -r
complete -c relay -n "__fish_seen_subcommand_from usage record" -l session -d "Session id to attribute usage to" -r

# savings options
complete -c relay -n "__fish_seen_subcommand_from savings" -l input-cost-per-million -d "Full-price input token cost per million" -r
complete -c relay -n "__fish_seen_subcommand_from savings" -l cached-input-cost-per-million -d "Cache-read input token cost per million" -r
complete -c relay -n "__fish_seen_subcommand_from savings" -l cache-creation-cost-per-million -d "Cache-write token cost per million" -r
complete -c relay -n "__fish_seen_subcommand_from savings" -l output-cost-per-million -d "Output token cost per million" -r
complete -c relay -n "__fish_seen_subcommand_from savings" -l session -d "Limit report to one session" -r
complete -c relay -n "__fish_seen_subcommand_from savings" -l json -d "Emit JSON"

# completion subcommands
complete -c relay -n "__fish_seen_subcommand_from completion; and not __fish_seen_subcommand_from bash zsh fish" -a "bash" -d "Print bash completion script"
complete -c relay -n "__fish_seen_subcommand_from completion; and not __fish_seen_subcommand_from bash zsh fish" -a "zsh" -d "Print zsh completion script"
complete -c relay -n "__fish_seen_subcommand_from completion; and not __fish_seen_subcommand_from bash zsh fish" -a "fish" -d "Print fish completion script"
`.trimStart();

export function installHint(shell: string): string {
  switch (shell) {
    case "bash":
      return [
        "",
        "# To enable relay completions in bash, add to ~/.bashrc:",
        '#   source <(relay completion bash)',
        "# Or for a permanent installation:",
        '#   relay completion bash > /etc/bash_completion.d/relay',
      ].join("\n");
    case "zsh":
      return [
        "",
        "# To enable relay completions in zsh, add to ~/.zshrc:",
        '#   source <(relay completion zsh)',
        "# Or for a permanent installation:",
        '#   relay completion zsh > "${fpath[1]}/_relay"',
      ].join("\n");
    case "fish":
      return [
        "",
        "# To enable relay completions in fish:",
        "#   relay completion fish | source",
        "# Or for a permanent installation:",
        "#   relay completion fish > ~/.config/fish/completions/relay.fish",
      ].join("\n");
    default:
      return "";
  }
}
