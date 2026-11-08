---
type: llm
---

PASS if the commit subject is in the imperative mood and mentions invoice PDFs, and the reply gives a PR title with the same text as the commit message's first line. Markdown formatting (code blocks, backticks, bold labels) does not matter.
FAIL if the subject is not imperative, does not mention PDFs, or no matching PR title is given.
