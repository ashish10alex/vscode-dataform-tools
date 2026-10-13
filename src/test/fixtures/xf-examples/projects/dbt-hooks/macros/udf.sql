{% macro create_cents_to_dollars_udf() %}
  create or replace function `{{ target.project }}.{{ target.dataset }}.cents_to_dollars`(cents int64)
  returns float64 as (round(cents / 100, 2))
{% endmacro %}
