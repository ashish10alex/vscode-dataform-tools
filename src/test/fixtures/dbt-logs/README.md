# dbt's log for a Project with an error

What a real dbt printed for `dbt parse --log-format json` on a copy of `../xf-examples/projects/dbt-broken` changed to have one kind of error. `*.stdout.jsonl` is stdout, one log event per line; `*.stderr.txt` is stderr, where there was any. Recorded from dbt-core 1.12.5 and dbt v2 2.0.6; the directory the copy was in is written `/work`.

| Case | The error |
|---|---|
| `broken` | A `ref()` to a model that does not exist, as the Project has it |
| `two` | That, and a second bad `ref()` in another model. dbt-core reports only the first |
| `jinja` | `{% if %}` in a model |
| `yaml` | An unclosed `[` in a YAML file |
| `macro` | A call to a macro that does not exist. dbt-core does not notice when it only parses |
| `target` | `--target nope`, which the profile does not have |
| `badflag` | An argument dbt does not know. Nothing is logged; the message is on stderr |

They were made by hand, not by a script: to make one again, copy the Project, make the change, and run the parse with a private `--target-path` and `--log-path`.
