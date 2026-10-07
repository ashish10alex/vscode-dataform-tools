select order_id, `{{ target.project }}.{{ target.dataset }}`.cents_to_dollars(amount_cents) as amount
from {{ ref('orders') }}
