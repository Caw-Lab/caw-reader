# smltxt analysis record (requests and reports) — English translation

**This is a translation.** The record itself is the Japanese original, [`smltxt-cleanroom-record-2026-10-24.txt`](smltxt-cleanroom-record-2026-10-24.txt), kept unedited. The SHA-256 values below were computed over the Japanese text of each part and can be checked only against the original. Where this translation and the original differ, the original applies.

Created: 2026-10-24

## About this record

- These are the original texts of the requests to ChatGPT Codex and the reports from it, made when Codex was asked to look into the smltxt format in order to write the body-decoding part of the viewer (viewer.caw-japan.com).
- The requests were copied from the Codex screen, and the reports are as received from Codex; neither was edited.
- Target: GitHub GilgameshCaw/Caw, `smltxt/` at commit 97cd13f3a1423f702d411472fdd2b2a2e7bfbd59.
- The decoding part of the viewer (from `// <smltxt>` to `// </smltxt>` in the source) was written by Claude based only on these two reports and the values observed in test posts. Claude did not read the smltxt source code.
- For testing, the statistics table in the upstream public repository (the data inside `src/tableData.ts`) was loaded programmatically, and its SHA-256 and the decoding results were checked. The contents of the table are not in the viewer's file.

Order of the parts and the SHA-256 of each (computed over the body text only; for detecting tampering)

```
Request 1   51fccd04e6dc9c2cd341f22bb9340d4dc49783fce13b5ed7feba72ccf2c7b9af
Report 1    26817027c5bfd8986a1df3406773f7784f8873fa623cd07c4c1ab1541b8c8263  attached to the chat 2026-10-24 13:30
Request 2   90cb9b7f4db75698e2807a6e49ac1a1cd0cbdc89b677bf5fea523d2599b284c8
Report 2    ed14ab8fe039caac3d73b53d0ff7c3c9c1dcda679a2821e52fb2fa0310f38501  attached to the chat 2026-10-24 13:36
```

Times are Japan time. The times the requests were sent and the times Codex produced the reports were not recorded, so they are not listed.

---

## Request 1 (initial investigation)

It is enough to get only the `smltxt/` directory running. No DB, Redis, Prisma or front-end setup is needed.

Investigate the text compression mechanism in the `smltxt/` directory of the GitHub repository GilgameshCaw/Caw (master), and write a report in Japanese.

**Purpose of this work**

Posts in this repository are compressed with smltxt and then put on the blockchain. Another person will write a compatible reader from scratch, looking only at the text of your report (clean-room method). Therefore, the most important thing is that the report contains no code at all. This analysis is for keeping compatibility and is not for profit.

**Things you must follow**

- Do not change any files in the repository. Do not commit, create branches or create PRs. The only deliverable is the text of the report.
- Do not put code in the report. No code blocks, no function bodies, and no pseudocode that traces the structure of the original code. Explain in Japanese prose, tables and diagrams of bit sequences. Mention function and file names only as far as needed to point to a location.
- Do not copy any part of the contents of large tables or data such as `src/tableData.ts` (about 520 KB). You may write only "what the table represents", "how it was made" and "how large it is".
- When writing a guess, mark it explicitly as "guess", and keep it clearly separate from what you confirmed by reading the code or actually running it.

**Suggested reading order**

README.md -> src/index.ts -> src/SmlTxt.ts -> src/sizeEncoding.ts -> src/huff.ts and src/SmlContext.ts -> src/parseTableData.ts and src/TableBuilder.ts -> programs/digestPosts.ts and programs/buildTableData.ts

**Items to cover in the report**

1. Overall structure of the compressed bytes: is there a marker or flag at the start? If so, how many bits or bytes, and what it means. How is the length represented?
2. Are bodies ever stored uncompressed? If so, how to tell.
3. The coding unit (character, word, byte, etc.) and the bit order (from the high bit or the low bit).
4. Code tables, dictionaries and statistics tables: what they represent, how they were made (from what input, by what procedure), and whether anyone can rebuild them with the same procedure or only with the original input data.
5. Handling of non-ASCII characters such as Japanese and emoji.
6. How the end is detected, and what happens to the last leftover bits.
7. Handling of upper and lower case, URLs, and repetitions of the same word (these show characteristic results in the test data below).
8. For two of the test vectors below, "a" and "test", show bit by bit why following the report's explanation gives that value.
9. Compress all 12 test vectors below by actually running the repository's smltxt, check whether the outputs match, and put the results in a table (input, expected value, actual output, match).

**Test data (values actually observed on the blockchain)**

| Body | Compressed bytes |
| --- | --- |
| a | 0x4760 |
| z | 0x37d0 |
| aa | 0x4758a0 |
| test | 0x2519d8 |
| Test | 0x1259d8 |
| test test | 0x2519d2f5d8 |
| hello world | 0xbdd5f39c115c |
| https://caw.is | 0xbdffcbfe0866d79f7d17caad88eb617622fc74a7 |
| あ | 0xf84c |
| 漢 | 0xcd6eb2 |
| 👍 | 0xdabbd848 |
| ギルさん起きてwakeup(test) | 0xf4b9fdc77c35f4eaeb0624f809f15ef5cbce2a4e43e796edb1 |

Write the report in Markdown, following headings 1-9 above.

---

## Report 1 (answer to request 1)

**Investigation report on the smltxt text compression format**

The target is `smltxt/` in master of GilgameshCaw/Caw, commit 97cd13f3a1423f702d411472fdd2b2a2e7bfbd59. The following are results confirmed by reading and running the implementation. No guesses are included.

No repository files were changed, and no commits, branches or PRs were created. Node.js was used for execution; no DB, Redis, Prisma or front end was used.

### 1. Overall structure of the compressed bytes

The compression replaces each UTF-8 byte with a Huffman code that depends on the preceding state.

There is no magic number, version number, flag, original character count, original byte count or code table at the start. The structure is:

| Order | Content | Length |
| --- | --- | --- |
| From the start | The codes for each UTF-8 byte of the body, concatenated | Variable |
| Right after the body | A 1 marking the end | 1 bit |
| Last | 0s padding to a byte boundary | 0-7 bits |

In other words, the whole is "the code bits of the body -> 1 -> as many 0s as needed". Because a 1 always remains at the end, the last byte of valid output is never 0.

The number of valid body bits is determined from the end. The original character count and UTF-8 byte count are not known until decoding. The length of the whole input byte string must be given from outside, such as by the storage format on the blockchain.

The compressed output carries no identifier of the code table either. Therefore, the reader must share the same statistics table as the writer in advance.

References: src/SmlTxt.ts, src/BitWriter.ts, src/BitReader.ts.

### 2. Are bodies ever stored uncompressed?

smltxt itself has no path for storing uncompressed.

Even short inputs, or inputs that grow when compressed, go through the same coding and termination. For example, "a" is 1 byte in UTF-8 but 2 bytes as a result. "aa" goes from 2 bytes to 3 bytes.

There is also no flag to tell compressed from uncompressed. So the format of this library alone cannot decide that "this is raw UTF-8, read it as is".

This is a finding about the specification inside `smltxt/`. Whether the outer storage format on the blockchain has any other distinction is outside the scope of this investigation.

### 3. Coding unit and bit order

**Coding unit**

The unit is neither a character nor a word but one UTF-8 byte. The values coded are the 256 values 0-255.

However, even the same byte uses a different Huffman tree depending on the preceding state. The state is formed by classifying each of the previous 2 bytes into one of these 39 classes:

| Kind of byte | Class number |
| --- | --- |
| Other | 0 |
| Letters a-z, A-Z | 1-26. Upper and lower case share a number |
| Space | 27 |
| Digits 0-9 | 28-37 |
| Printable ASCII other than letters, digits and space | 38 |

The last class includes common punctuation as well as brackets, slash, underscore and so on. Newline, tab, non-ASCII bytes and the like are "other".

The state number is the older class number times 39 plus the newer class number. There are 39 x 39, i.e. 1,521, states in total.

Each body starts in state 0, which is the same as both preceding classes being "other". Each time a byte is encoded or decoded, that byte's class is reflected in the state.

Importantly, what is classified is the preceding byte; the byte currently being coded is not replaced by its class number. The current byte is still distinguished among all 256 values.

**Bit order**

Bits are read and written from the high bit to the low bit of each byte. In the Huffman tree, the left branch is 0 and the right branch is 1.

Even if a code crosses a byte boundary, nothing separates it. The next code continues right after.

References: src/SmlContext.ts, src/huff.ts, src/BitWriter.ts, src/BitReader.ts.

### 4. Code tables, dictionaries and statistics tables

**What the table represents**

It is not a word dictionary but a statistics table of the quantized frequency of the next UTF-8 byte in each state.

| Item | Size |
| --- | --- |
| Number of states | 1,521 |
| Target bytes per state | 256 |
| Storage per frequency | 1 byte |
| Statistics table itself | 389,376 bytes |
| Embedding file src/tableData.ts | 519,558 bytes |

The statistics table is ordered by ascending state number, and within each state by ascending target byte value. Each state's region is 256 bytes.

A Huffman tree is built per state from this table, from which the encoding codes and the decoding tree are derived. The contents of the table and individual frequency values are not reproduced in this report.

**Training input and procedure**

The procedure that can be confirmed from the README and the generator programs is:

1. Prepare post bodies, one JSON string per line.
2. If the source data is in data/post-stream/, read the JSON files under it, take the text of the posts in includes.posts on each line, and collect them into this format.
3. Split the set of posts into training and evaluation.
4. Convert each training body to UTF-8. Reset the state to 0 at the start of each body.
5. For each byte, count occurrences of the combination of "the state just before it" and "the current byte".
6. Quantize the frequencies per state to make the statistics table.
7. Base64-encode the statistics table and embed it in a TypeScript file for distribution.

The README has an example of taking 6 million training posts out of about 6.46 million. However, this is an example of the procedure, not a record showing that the bundled table was actually made from that number or that set of posts. The source of the original posts cannot be determined from this generation process alone either.

**Quantizing and restoring frequencies**

Quantization is done independently per state.

Each count is scaled proportionally so that the most frequent byte's count becomes one billion. It is then rounded to an integer 0-255 on a logarithmic scale. The lower end of the scale is 10 and the upper end one billion. A zero frequency also becomes stored value 0.

For restoring, a scale increasing from 10 to one billion in 255 equal-ratio steps is used, and the weight for a stored value is rounded to an integer. The ratio between adjacent steps is the 255th root of 100 million.

So the restored weights are not the original counts. Also, bytes that did not occur in training get positive weights, so no special escape code for unseen bytes is needed.

**Rules for building the same Huffman tree**

Even from the same weights, different tie handling gives different codes. Compatibility also needs these rules:

- Put the initial leaves in ascending order of target byte value.
- Sort by ascending weight, keeping the order among equal weights.
- Take out the two smallest; the first one taken is left, the next is right.
- The parent's weight is the sum of the two weights.
- Append the new parent at the end of the remaining sequence, then apply the same stable sort again.

Therefore, if a new parent and an existing node have the same weight, the existing node comes first. When using a generic Huffman implementation, this tie rule must also be matched.

**What can be rebuilt, and the limits of this report alone**

With the same statistics table, the same Huffman trees and codes can be rebuilt without the original set of posts.

On the other hand, re-creating the bundled table from training needs the same training input as the original. The original training set of posts is not included in the investigated code. Re-training on a different set of posts does not guarantee compatibility with existing data.

Therefore, the decoding procedure can be implemented from this report alone, but decoding arbitrary existing posts separately requires the same statistics table. Given the condition not to reproduce large tables, that gap cannot be filled by the text of this report. The bit sequences needed for the test examples below do not allow reconstructing the table for all states and all bytes.

References: src/sizeEncoding.ts, src/huff.ts, src/parseTableData.ts, src/TableBuilder.ts, programs/digestPosts.ts, programs/buildTableData.ts.

### 5. Handling of non-ASCII characters such as Japanese and emoji

There is no coding scheme specific to Japanese or emoji. Text is first converted to UTF-8, and its bytes are coded one by one.

| Input | UTF-8 bytes | Compressed bytes this time |
| --- | --- | --- |
| あ | 3 | 2 |
| 漢 | 3 | 3 |
| 👍 | 4 | 4 |

All the bytes making up a non-ASCII character are classed as "other" when the state is updated. As coding targets, though, they are each distinct byte values.

For example, while a body starts with only Japanese, the state stays 0. When letters follow Japanese, the state changes as the letters are processed.

Decoding rebuilds the byte sequence and then converts it back to a string as UTF-8. No Unicode normalization, kana conversion or emoji replacement is done. Combining characters and emoji modifiers follow the input UTF-8 bytes.

However, the standard string conversion used has these properties:

- Invalid UTF-8 becomes the replacement character on decoding.
- A lone surrogate in a JavaScript string becomes the replacement character at the UTF-8 conversion step.
- If decoded text starts with a UTF-8 BOM, the standard decoder removes it.

The last two were also confirmed in an additional experiment. So the scheme does not guarantee a perfect round trip for every JavaScript string. All 12 bodies specified this time went back to the original body after compression.

### 6. End detection and the last leftover bits

Remove the consecutive 0s from the low end of the last byte, and also the 1 just before them; what remains is the valid bit sequence of the body.

| Part at the end | Meaning |
| --- | --- |
| Consecutive 0s at the low end of the last byte | Padding |
| The 1 just before them | Bit marking the end |
| Everything before | The code bits of the body |

The terminating 1 can also appear inside the body. The key point is not to decide "it ends when a 1 comes" from the start, but to fix the valid length from the last byte of the whole input.

While valid bits remain, follow the Huffman tree of the current state. On reaching a leaf, output one byte, update the state with that byte, and read on from the root of the next tree. Stop when the valid bits are used up.

Input whose valid bits run out in the middle of a Huffman code is a read-underflow error. Input whose last byte is 0 is also rejected. However, there is no checksum, so corrupted data is not always detected.

Compressing the empty string gives 0x80: no body codes, only the terminating 1 and padding 0s. The implementation also decodes a zero-length input byte string to the empty string, but the value normal compression produces for the empty string is 0x80.

### 7. Upper and lower case, URLs, repetitions of the same word

**Upper and lower case**

As the byte being coded, upper and lower case are distinguished. In the state used to choose the next code table, they are not.

So "test" and "Test" differ in the first code, but the following states are the same, and the codes for the remaining "est" are the same. It is not a scheme that converts upper case to lower case or adds a capital flag.

**URLs**

There is no special recognition, shortening or replacement of URLs. Colons and slashes are processed as ordinary UTF-8 bytes.

This time, compressing the body https://caw.is gave 0xbdffe4d6866c8584. It does not match the given expected value.

Decoding the given expected value with the same library gave https://tencawffee.com/s/knTDbd. Re-compressing that string matched the given expected value exactly.

This is a fact confirmed by running. How the expected value came to change from https://caw.is to that value was not judged.

**Repetitions of the same word**

There is no registration in a word dictionary, no back-reference and no recording of repetition counts.

The second "test" in "test test" gets different codes from the first because the preceding state differs. The first starts from the state at the beginning of the body; the second starts from the state formed by the preceding "t" and space.

In the second word too, after processing "te" the state becomes the same as in the first. So the remaining "st" get the same codes. This is not reuse of the word but an effect of classifying the previous 2 bytes.

### 8. Bit-level check of "a" and "test"

The following are not reproductions of the statistics table itself but the code sequences obtained at run time for the two specified inputs.

**"a" -> 0x4760**

The state at the start of the body is 0.

| Target | UTF-8 byte value | State just before | Code obtained |
| --- | --- | --- | --- |
| a | 97 | 0 | 0100011101 |

The body code is 10 bits. Then a terminating 1 and five 0s up to the byte boundary are added.

| Part | Bits |
| --- | --- |
| Body | 0100011101 |
| Terminator | 1 |
| Padding | 00000 |
| Whole, split into 8 bits | 01000111　01100000 |
| Hexadecimal | 47　60 |

So the result is 0x4760.

On decoding, removing the last five 0s and the 1 just before them leaves only the original 10 bits.

**"test" -> 0x2519d8**

| Target | UTF-8 byte value | State just before | Code obtained |
| --- | --- | --- | --- |
| t | 116 | 0 | 0010010100 |
| e | 101 | 20 | 0110 |
| s | 115 | 785 | 0111 |
| t | 116 | 214 | 01 |

The state changes as follows:

- After the first t, state 20 from classes 0 and 20.
- After the next e, state 785 from classes 20 and 5.
- After the next s, state 214 from classes 5 and 19.

The body code is 20 bits in total.

| Part | Bits |
| --- | --- |
| t | 0010010100 |
| e | 0110 |
| s | 0111 |
| t | 01 |
| Whole body | 00100101000110011101 |
| Terminator | 1 |
| Padding | 000 |
| Whole, split into 8 bits | 00100101　00011001　11011000 |
| Hexadecimal | 25　19　d8 |

So the result is 0x2519d8.

### 9. Results for all 12 cases

The TypeScript source of the target commit was actually run to compress. The bundled distribution JavaScript was also confirmed to give the same results.

The URL input was treated as https://caw.is, the link target and displayed string in the table. The Markdown link syntax itself was not included in the body.

| Input | Expected | Actual output | Match |
| --- | --- | --- | --- |
| a | 0x4760 | 0x4760 | ○ |
| z | 0x37d0 | 0x37d0 | ○ |
| aa | 0x4758a0 | 0x4758a0 | ○ |
| test | 0x2519d8 | 0x2519d8 | ○ |
| Test | 0x1259d8 | 0x1259d8 | ○ |
| test test | 0x2519d2f5d8 | 0x2519d2f5d8 | ○ |
| hello world | 0xbdd5f39c115c | 0xbdd5f39c115c | ○ |
| https://caw.is | 0xbdffcbfe0866d79f7d17caad88eb617622fc74a7 | 0xbdffe4d6866c8584 | × |
| あ | 0xf84c | 0xf84c | ○ |
| 漢 | 0xcd6eb2 | 0xcd6eb2 | ○ |
| 👍 | 0xdabbd848 | 0xdabbd848 | ○ |
| ギルさん起きてwakeup(test) | 0xf4b9fdc77c35f4eaeb0624f809f15ef5cbce2a4e43e796edb1 | 0xf4b9fdc77c35f4eaeb0624f809f15ef5cbce2a4e43e796edb1 | ○ |

11 of 12 matched the expected values. For all 12, decoding the compressed output actually produced gave back the input body.

The expected value for the mismatching URL was confirmed, in both directions of decoding and re-compressing, to be the compression of a different body, https://tencawffee.com/s/knTDbd.

---

## Request 2 (five follow-up points)

As a supplement to the previous report, investigate the following five points and answer in Japanese prose and tables. As before, do not write code, pseudocode or table contents, and do not change repository files.

1. How `src/tableData.ts` is wrapped: in what form is the statistics table inside the TypeScript file? For example, "one string in one variable" or "split into multiple strings". Which kind of Base64 is it: standard, URL-safe, or the custom alphabet of `src/Base64.ts`? Are there line breaks or separators? Do not write the contents of the string.
2. Byte count and SHA-256 of the decoded statistics table: show whether the bytes restored from Base64 are 389,376 bytes, and the SHA-256 of those bytes in hex (to be used to detect tampering).
3. How a stored value (0-255) is turned back into a weight: explain in prose, exactly, including rounding. For example, "multiply 10 by the 255th root of 100 million raised to the power v, and round half up". Also show the weights actually obtained for v=0, v=1, v=254 and v=255. Is the calculation done in 64-bit floating point?
4. Exact class numbering: are letters a/A=1 … z/Z=26? Are digits 0=28 … 9=37? Is "printable ASCII other than letters, digits and space" 0x21-0x7E minus the alphanumerics?
5. Details of building the Huffman tree: are all 256 leaves always included? Is the sort used for re-ordering one that keeps the order of equal weights (a stable sort)? Before the first re-ordering, are the leaves in ascending byte order?

---

## Report 2 (answer to request 2)

The same commit 97cd13f3a1423f702d411472fdd2b2a2e7bfbd59 was checked. The following are results confirmed by reading and running the implementation. No repository files were changed.

### 1. How src/tableData.ts is wrapped

| Item | Finding |
| --- | --- |
| Storage form | One string literal in one variable |
| Splitting or concatenation of the string | None |
| Kind of Base64 | Standard Base64, not URL-safe |
| Line breaks, spaces or separators in the string | None |
| String length | 519,168 characters |
| Trailing padding | None. Not needed because the original byte count is a multiple of 3 |
| Processing on load | Decodes the Base64 into a byte array and exports that array as the default export |

Node.js decodes with the standard Buffer; browsers with the standard atob.

**src/Base64.ts has no custom alphabet.** It also uses the standard btoa and atob. However, src/tableData.ts does not use this file and has its own decoding.

### 2. Byte count and SHA-256 of the decoded statistics table

The same result was confirmed both by decoding the string as standard Base64 and by actually loading the TypeScript module.

| Item | Result |
| --- | --- |
| Byte count | 389,376 bytes |
| SHA-256, lower-case hex | 3b1111b5c9e2dbc249f93f1bd46cc2ce8d663e44cefc585a9288632fff024e30 |

This hash is over the bytes of the statistics table restored from Base64, not over the TypeScript file or the Base64 string.

### 3. Exact way a stored value is turned back into a weight

With stored value v, the implementation computes in this order:

1. Take one billion divided by 10, i.e. the natural logarithm of 100 million.
2. Multiply that natural logarithm by the reciprocal of 255. This is the common coefficient.
3. Multiply v by the coefficient and apply the natural exponential function.
4. Multiply the result by 10.
5. Round to the nearest integer. Exactly halfway between two integers, round to the larger.

Since the values are all positive, the last step is ordinary rounding half up, not rounding half to even.

Mathematically this is equivalent to "multiply 10 by the 255th root of 100 million raised to the power v, and round", but the implementation does not compute the root first; it uses the natural log and natural exponential order above.

| Stored value v | Weight obtained by the implementation |
| --- | --- |
| 0 | 10 |
| 1 | 11 |
| 254 | 930,309,490 |
| 255 | 1,000,000,000 |

The calculation uses JavaScript's Number, i.e. IEEE 754 64-bit double-precision floating point. The table above was confirmed by running the implementation on Node.js 22.22.0.

### 4. Exact class numbering

Your understanding is correct. The implementation's results were also checked for all 256 bytes.

| Byte range or kind | Class number |
| --- | --- |
| A-Z, 0x41-0x5A | A=1, B=2, …, Z=26 |
| a-z, 0x61-0x7A | a=1, b=2, …, z=26 |
| Space, 0x20 | 27 |
| Digits, 0x30-0x39 | 0=28, 1=29, …, 9=37 |
| 0x21-0x7E minus the alphanumerics above | 38 |
| Everything else | 0 |

In finer detail, class 38 covers:

| Range | Class number |
| --- | --- |
| 0x21-0x2F | 38 |
| 0x3A-0x40 | 38 |
| 0x5B-0x60 | 38 |
| 0x7B-0x7E | 38 |

Space 0x20 is not in 0x21-0x7E to begin with. Newline, tab, DEL and non-ASCII bytes are class 0.

### 5. Details of building the Huffman tree

| Point checked | Result |
| --- | --- |
| Are all 256 leaves always included? | Yes, when reading a valid statistics table. Leaves for all byte values 0-255 are included |
| Are bytes with zero frequency excluded? | No. Stored value 0 is also restored to a positive weight |
| Order of the leaves before the first sort | Ascending byte value 0, 1, …, 255 |
| Sort key | Ascending weight |
| Order among equal weights | A stable sort that keeps the original order |
| Left and right when joining two | The first smallest taken out is left, the next is right |
| Where the new parent is added | At the end of the remaining sequence, then stable-sorted again |

The stability comes not from a custom sort but from using JavaScript's standard array sort. Since ECMAScript 2019, that sort is guaranteed stable by the specification. Node.js 22 used here qualifies.

So if a new parent and an existing node have the same weight, the existing node stays first. Among parents with the same weight, the existing order is also kept. A compatible implementation must match this tie handling as well as the weights.

Note that the internal tree-building routine itself follows the number of weights it is given. "256 leaves" holds as a property of the path that reads 256 weights per state from a valid statistics table.

---

(End of record)
