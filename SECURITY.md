# Security

This tool runs on an engineer's laptop and reads their Claude Code skills and session transcripts.
Its promises are in `docs/spec.md` §5: pinned version with npm provenance, no network call, one
readable file, redaction with a report, no identity in the output, every failure counted.

If you find a way to make it send data, open a file the spec does not name, or leave a username,
hostname, machine id, home path, transcript content or credential in its output, please report it
privately to security@terum.ai rather than in a public issue. Include the version, the operating
system, and the smallest folder layout that reproduces it.
