{{
  config(
    materialized='table',
    partition_by={'field': 'first_order_date', 'data_type': 'date'},
    cluster_by=['customer_id'],
    pre_hook="declare run_started timestamp default current_timestamp()",
    post_hook="alter table {{ this }} set options (description = 'Customers with their order history')",
  )
}}

with orders as (
  select
    o.customer_id,
    min(o.order_date) as first_order_date,
    count(*) as order_count,
    sum(p.amount) as lifetime_value
  from {{ ref('stg_orders') }} as o
  left join {{ ref('stg_payments') }} as p using (order_id)
  group by 1
)
select
  c.customer_id,
  c.email,
  c.country_code,
  o.first_order_date,
  coalesce(o.order_count, 0) as order_count,
  coalesce(o.lifetime_value, 0) as lifetime_value
from {{ ref('stg_customers') }} as c
left join orders as o using (customer_id)
