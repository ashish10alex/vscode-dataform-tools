-- An ad hoc query: compiled, never built.
select country_code, sum(lifetime_value) as revenue
from {{ ref('dim_customers') }}
group by 1
order by 2 desc
