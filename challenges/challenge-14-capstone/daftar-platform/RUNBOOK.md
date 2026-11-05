# Runbook: Daftar platform

This is the page a person opens at 3 am. Write one entry for each failure you caused in part 3 of the capstone.
Be short and exact: what they see, what to type, what normal looks like.

## How to write an entry

Copy this template under "Entries" and fill every line. Each field needs at least a few words.
The **Check** line needs the commands in backticks. The **Measured** line needs the number from your own experiment, in seconds.

```
### Name of the failure
- **Symptom:** what a person sees (a page that does not load, jobs that stay queued)
- **Check:** the commands, in order, for example `docker compose ps` and `docker compose logs api`
- **Cause:** what is really wrong
- **Fix:** what to do now
- **Prevention:** the setting or the code that stops it next time
- **Measured:** 4.1 s
```

## Entries
