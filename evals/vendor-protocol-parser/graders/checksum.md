---
type: llm
---

Look only at the checksum. The correct rule is: byte 8 = (sum of bytes 1 through 7) & 0xFF, i.e. the 8-bit sum of every byte after the 0xAA header up to and including the flags byte. PASS if the answer states this rule (any equivalent wording or code, e.g. summing bytes from index 1 to 7 modulo 256) and the parser checks it. FAIL if it includes the 0xAA header in the sum, uses XOR/CRC, or leaves the checksum unidentified.
