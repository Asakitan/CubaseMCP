# Fixed Save command: contract boundary

The installed Cubase 16.0.5 factory script `midiremote_factory_scripts/Public/arturia/keylab_essential_common.js` contains a `page.makeCommandBinding` for category `File`, command `Save`. This confirms an installed MIDI Remote example of a fixed command binding, not a successful MCP save or a general project lifecycle interface.

The installed `midiremote_api_v1.d.ts` declares `MR_CommandBinding.mOnValueChange`, `filterByValue` and `canPerform`. Those members do not provide a named-project path, a dirty-state query, a correlated save-completion/error callback, or a guarantee that every save is noninteractive. `canPerform` alone is not evidence of completed persistence. The separately traced save body has conditional alert-provider and target-file branches (`project-save-preflight.md`, `project-save-target.md`).

Revision 3.13 uses the dedicated minimal Save page, a prepared token/deadline, one physical MIDI press, matching binding observation, one release and return to the primary page. `cubase_command_execute` requires the current session and `confirmCurrentSelection: true`. The returned **new session** replaces the old session and invalidates its discovered objects. A saved, unarmed internal page returns to the primary page on startup without Save input. See [protocol and evidence](project-save-chain-28.md).

The response still reports submission only: the host determines the active project and destination and may request input. There is no path argument, save-as or correlated disk completion callback. A timeout after input remains unknown and is not replayed. The earlier session-27 Save remains unverified; a distinct real MCP experiment subsequently observed tempo 146.75, a changed CPR and the same tempo on fresh-process reopen. That is a verified concrete persistence chain, not a universal save guarantee.

Session 29 adds a separate `cubase_project_save_as` lifecycle tool with native document-path binding. The fixed MIDI `project.save` contract remains unchanged; see `background-project-lifecycle.md`.
