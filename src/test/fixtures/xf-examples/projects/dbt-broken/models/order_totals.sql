-- Deliberately broken: no model is called order_lines.
select o.order_id, count(*) as lines
from {{ ref('orders') }} as o
join {{ ref('order_lines') }} as l using (order_id)
group by 1
