{{ config(materialized='materialized_view') }}

select order_date, sum(amount) as revenue
from {{ ref('fct_orders') }}
group by 1
