
publish("test_js_table_1").query(ctx => "select 1 as a");

publish(
    "test_js_table_2",
    `
    select 12 as a
    `
);


operate(
    "test_js_ops",
    `
    create or replace table
    drawingfire-b72a8.dataform.test_js_ops
    as 
    select 14 as b
    `
);

assert(
    "test_js_assert",
    `
    select 14 as b
    `
);