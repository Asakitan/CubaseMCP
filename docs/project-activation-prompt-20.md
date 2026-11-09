# Project activation prompt: fixed-build static evidence

The private prompt captured after the one-shot session 20 host-open submission asks whether to activate a project; no choice was made and the request remains `unknown` (`project-open-probe-20.md`). Its appearance does not prove that the copied CPR is loaded or selected.

In the installed Cubase 16.0.5 x64 executable with PE timestamp `0x6adf121b`, the Chinese UTF-8 prompt appears at file offset `0x5c026c4`, RVA `0x5d282c4`. Its surrounding embedded translation XML associates it with the English key `Do you want to activate the project?`. That key also appears as UTF-16 at file offset `0x42e5b10`, RVA `0x42e7510`.

A verified fixed-image instruction at RVA `0x1335b08` loads the UTF-16 key's address using RIP-relative addressing; the following call at `0x1335b16` targets RVA `0x3a7f450`. PE exception metadata places the instruction in runtime function `0x13359f0`–`0x1335bab`. The surrounding code's resource-initialization shape is consistent with translation registration, but this observation does not identify the dialog's display function, the triggering branch, a noninteractive parameter, or a causal call path from the submitted request. All addresses are build-specific disk observations, not a public ABI.

The fixed image may be rechecked with `pefile` and `capstone`: locate the two encodings in the file, map the offsets with `PE.get_rva_from_offset`, disassemble bytes at RVA `0x1335b00`, and query the PE exception directory for the containing runtime function. The observed screenshot and these static facts establish neither completion nor persistent project content.
