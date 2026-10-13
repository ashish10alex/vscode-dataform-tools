{{
  config(
    materialized='incremental',
    unique_key='order_id',
    incremental_strategy='merge',
    partition_by={'field': 'order_date', 'data_type': 'date'},
  )
}}

select
  o.order_id,
  o.customer_id,
  o.order_date,
  o.status,
  sum(p.amount) as amount
from {{ ref('stg_orders') }} as o
left join {{ ref('stg_payments') }} as p using (order_id)
{% if is_incremental() %}
where o.order_date > (select max(order_date) from {{ this }})
{% endif %}
group by 1, 2, 3, 4
