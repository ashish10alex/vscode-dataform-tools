-- Built in the reporting schema under the alias revenue_report.
{{ config(materialized='table', alias='revenue_report') }}

select c.country_code, sum(o.amount) as revenue
from {{ ref('fct_orders') }} as o
join {{ ref('dim_customers') }} as c using (customer_id)
group by 1
