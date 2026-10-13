{% macro create_cents_to_dollars_udf() %}
  create or replace function `{{ target.project }}.{{ target.dataset }}.cents_to_dollars`(cents int64)
  returns float64 as (round(cents / 100, 2))
{% endmacro %}

{% macro record_run_in_audit_log() %}
  create table if not exists `{{ target.project }}.{{ target.dataset }}.audit_log` (run_at timestamp, model string, row_count int64);
  insert into `{{ target.project }}.{{ target.dataset }}.audit_log` (run_at, model, row_count)
  select current_timestamp(), 'fct_orders', count(*) from {{ ref('fct_orders') }}
{% endmacro %}
