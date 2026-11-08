---
type: llm
---

PASS if the reply asks the user why the search settings changed (or what the change is for) before giving a final message, names the specific changes it is unsure about (for example fewer results per page, fuzzy matching turned off, or the shorter timeout), explains that the answer decides the type (fix, perf or feat) or the body, and does not state an invented reason as fact; any draft message is clearly marked as provisional.
FAIL if it presents a final message with an invented rationale.
