{% macro cents_to_dollars(column) -%}
  round({{ column }} / 100, 2)
{%- endmacro %}
