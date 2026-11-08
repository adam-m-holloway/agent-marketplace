---
type: llm
---

PASS if the BREAKING CHANGE footer tells callers what to do (for example pass a time zone such as 'UTC'), and the reply gives a PR title with the same text as the commit message's first line, including the '!'. Markdown formatting (code blocks, backticks, bold labels) does not matter.
FAIL if the footer gives callers no guidance or no matching PR title is given.
