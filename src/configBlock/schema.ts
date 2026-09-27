import { ProtoField, protoEnums, protoMessages } from './schema.generated';

/**
 * The keys accepted in a `.sqlx` `config {}` block.
 *
 * Dataform core accepts the proto keys from configs.proto (see schema.generated.ts) plus the legacy
 * SQLX keys it converts before validating (`schema`, `database`, `dependencies`, `bigquery: {...}`,
 * object style `columns`). See `verifyConfig` in dataform-co/dataform core/actions/*.ts.
 */

export type ValueKind = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'map' | 'any';

export interface EnumValue {
    name: string;
    doc: string;
}

export interface KeyInfo {
    name: string;
    kind: ValueKind;
    doc: string;
    enumValues?: EnumValue[];
    enumCaseInsensitive?: boolean;
    aliasOf?: string;
    example?: string;
    docsAnchor?: string;
}

/** Keys allowed inside one object of the config block. */
export type KeySet = Map<string, KeyInfo>;

export const SQLX_ACTION_TYPES = ['table', 'view', 'incremental', 'assertion', 'operations', 'declaration', 'test', 'dataPreparation'] as const;
export type SqlxActionType = typeof SQLX_ACTION_TYPES[number];

export const DEFAULT_ACTION_TYPE: SqlxActionType = 'operations';

const DOCS_BASE_URL = 'https://dataform-co.github.io/dataform/docs/configs-reference';

export function docsUrl(anchor: string): string {
    return `${DOCS_BASE_URL}#${anchor}`;
}

const actionTypeDocs: Record<SqlxActionType, string> = {
    table: 'Creates a table, rebuilt from scratch on every run.',
    view: 'Creates a view (or a materialized view with `materialized: true`).',
    incremental: 'Creates a table that is built once and then updated with new rows on later runs.',
    assertion: 'A data quality query. The assertion fails if the query returns any rows.',
    operations: 'Runs arbitrary SQL statements. This is the default when `type` is omitted.',
    declaration: 'Declares an existing BigQuery table as a data source.',
    test: 'A unit test for a table, view or incremental table.',
    dataPreparation: 'A BigQuery data preparation.',
};

const protoMessageForType: Partial<Record<SqlxActionType, string>> = {
    table: 'ActionConfig.TableConfig',
    view: 'ActionConfig.ViewConfig',
    incremental: 'ActionConfig.IncrementalTableConfig',
    assertion: 'ActionConfig.AssertionConfig',
    operations: 'ActionConfig.OperationConfig',
    declaration: 'ActionConfig.DeclarationConfig',
    dataPreparation: 'ActionConfig.DataPreparationConfig',
};

/** Keys of the legacy `bigquery: {}` option, per action type. */
const legacyBigQueryKeys: Partial<Record<SqlxActionType, string[]>> = {
    table: ['partitionBy', 'clusterBy', 'updatePartitionFilter', 'labels', 'partitionExpirationDays', 'requirePartitionFilter', 'additionalOptions', 'incrementalPredicates', 'iceberg'],
    incremental: ['partitionBy', 'clusterBy', 'updatePartitionFilter', 'labels', 'partitionExpirationDays', 'requirePartitionFilter', 'additionalOptions', 'incrementalPredicates', 'iceberg'],
    view: ['labels', 'additionalOptions', 'partitionBy', 'clusterBy'],
};

/** Legacy SQLX key name -> proto key it is converted to. */
const legacyAliases: Record<string, string> = {
    schema: 'dataset',
    database: 'project',
    dependencies: 'dependencyTargets',
    fileName: 'filename',
};

const enumValuesFor = (enumName: string, stripPrefix?: string): EnumValue[] =>
    (protoEnums[enumName] ?? [])
        .filter(value => !value.name.endsWith('_UNSPECIFIED'))
        .map(value => ({ name: stripPrefix ? value.name.replace(stripPrefix, '') : value.name, doc: value.doc }));

const exampleConfig = (type: string, body: string) => `config {\n  type: "${type}",\n${body}\n}`;

/** Extra docs and examples layered on top of the proto doc comments. */
const keyExtras: Record<string, Partial<KeyInfo>> = {
    uniqueKey: {
        example: exampleConfig('incremental', '  uniqueKey: ["user_id"]'),
    },
    nonNull: {
        doc: 'Asserts that the listed columns are never `NULL` in any row of the table.',
        example: exampleConfig('table', '  assertions: {\n    nonNull: ["user_id", "customer_id", "email"]\n  }'),
    },
    rowConditions: {
        doc: 'Asserts that every row satisfies each custom SQL condition. The assertion fails if any row evaluates to false.',
        example: exampleConfig('incremental', '  assertions: {\n    rowConditions: [\n      \'signup_date is null or signup_date > "2022-08-01"\',\n      \'email like "%@%.%"\'\n    ]\n  }'),
    },
    uniqueKeys: {
        example: exampleConfig('table', '  assertions: {\n    uniqueKeys: [["user_id"], ["email"]]\n  }'),
    },
    partitionBy: {
        example: exampleConfig('table', '  partitionBy: "DATE(created_at)"'),
    },
    clusterBy: {
        example: exampleConfig('table', '  clusterBy: ["customer_id"]'),
    },
    onSchemaChange: {
        doc: 'What to do when the query adds, removes or renames columns compared with the existing incremental table.',
        example: exampleConfig('incremental', '  onSchemaChange: "EXTEND"'),
    },
    incrementalStrategy: {
        doc: 'How new rows are written to the incremental table. `MERGE` matches rows on `uniqueKey`; `INSERT_OVERWRITE` replaces whole partitions and requires `partitionBy`.',
    },
    columns: {
        doc: 'Descriptions of columns in the dataset. Each value is a description string, or an object with `description`, `tags`, `bigqueryPolicyTags` and nested `columns`.',
        example: exampleConfig('table', '  columns: {\n    user_id: "Unique user identifier",\n    address: {\n      description: "Postal address",\n      columns: { city: "City name" }\n    }\n  }'),
    },
    bigquery: {
        doc: 'Legacy BigQuery options. These can also be set directly at the top level of the config block.',
    },
};

/** Keys inside `columns: { <column>: { ... } }`, including arbitrarily nested `columns`. */
export const COLUMN_DESCRIPTOR_KEYS: KeySet = new Map<string, KeyInfo>([
    ['description', { name: 'description', kind: 'string', doc: 'A description of the column.' }],
    ['displayName', { name: 'displayName', kind: 'string', doc: 'A display name for the column.' }],
    ['tags', { name: 'tags', kind: 'array', doc: 'Tags applied to the column.' }],
    ['bigqueryPolicyTags', { name: 'bigqueryPolicyTags', kind: 'array', doc: 'BigQuery policy tags applied to the column, e.g. `projects/<project>/locations/<location>/taxonomies/<id>/policyTags/<id>`.' }],
    ['columns', { name: 'columns', kind: 'object', doc: 'Descriptions of the nested columns of this struct, object or record.' }],
]);

function kindForField(field: ProtoField): ValueKind {
    if (field.type === 'map') {
        return 'map';
    }
    if (field.repeated) {
        return 'array';
    }
    switch (field.type) {
        case 'string':
            return 'string';
        case 'bool':
            return 'boolean';
        case 'int32':
        case 'int64':
        case 'uint32':
        case 'uint64':
        case 'float':
        case 'double':
            return 'number';
        default:
            return protoEnums[`ActionConfig.${field.type}`] || protoEnums[field.type] ? 'string' : 'object';
    }
}

/** Converts the fields of a proto message into a key set. */
function keySetFromMessage(messageName: string): KeySet {
    const keys: KeySet = new Map();
    for (const field of protoMessages[messageName] ?? []) {
        keys.set(field.name, {
            name: field.name,
            kind: kindForField(field),
            doc: field.doc,
            docsAnchor: `dataform-${messageName.replace(/\./g, '-')}`,
            ...keyExtras[field.name],
        });
    }
    return keys;
}

const nestedKeySets: Record<string, () => KeySet> = {
    assertions: () => {
        const keys = keySetFromMessage('ActionConfig.TableAssertionsConfig');
        const uniqueKey = keys.get('uniqueKey');
        if (uniqueKey) {
            // Not the incremental merge key: this one creates a uniqueness assertion.
            keys.set('uniqueKey', {
                ...uniqueKey,
                doc: 'Asserts that no two rows have the same values for these column(s).',
                example: exampleConfig('view', '  assertions: {\n    uniqueKey: ["user_id"]\n  }'),
            });
        }
        return keys;
    },
    iceberg: () => {
        const keys = keySetFromMessage('ActionConfig.IcebergTableConfig');
        const fileFormat = keys.get('fileFormat');
        if (fileFormat) {
            keys.set('fileFormat', { ...fileFormat, kind: 'string', enumValues: enumValuesFor('ActionConfig.IcebergTableConfig.FileFormat'), enumCaseInsensitive: true });
        }
        return keys;
    },
    metadata: () => keySetFromMessage('ActionConfig.Metadata'),
    errorTable: () => keySetFromMessage('ActionConfig.DataPreparationConfig.ErrorTableConfig'),
    loadMode: () => {
        const keys = keySetFromMessage('ActionConfig.LoadModeConfig');
        const mode = keys.get('mode');
        if (mode) {
            keys.set('mode', { ...mode, kind: 'string', enumValues: enumValuesFor('ActionConfig.LoadMode') });
        }
        return keys;
    },
};

/** Keys whose values are free form objects: their keys are never validated or completed. */
const freeFormObjectKeys = new Set(['labels', 'additionalOptions', 'extraProperties']);

/** Normalises the value kind of keys whose SQLX form differs from the proto form. */
function sqlxKind(info: KeyInfo): KeyInfo {
    if (info.name === 'columns' || nestedKeySets[info.name]) {
        // SQLX `columns` uses the legacy object form: { <column name>: "description" | { ...descriptor } }
        return { ...info, kind: 'object' };
    }
    if (freeFormObjectKeys.has(info.name)) {
        return { ...info, kind: 'map' };
    }
    return info;
}

const typeKeyInfo: KeyInfo = {
    name: 'type',
    kind: 'string',
    doc: 'The type of action this file defines. Defaults to `operations` when omitted.',
    enumValues: SQLX_ACTION_TYPES.map(name => ({ name, doc: actionTypeDocs[name] })),
};

const topLevelCache = new Map<SqlxActionType, KeySet>();

/** Top-level keys allowed in a `config {}` block of the given action type. */
export function getTopLevelKeys(type: SqlxActionType): KeySet {
    const cached = topLevelCache.get(type);
    if (cached) {
        return cached;
    }

    let keys: KeySet;
    const messageName = protoMessageForType[type];
    if (messageName) {
        keys = keySetFromMessage(messageName);
    } else {
        // `test` configs are checked against a fixed key list in core/actions/test.ts.
        keys = new Map<string, KeyInfo>([
            ['name', { name: 'name', kind: 'string', doc: 'The name of the test.' }],
            ['dataset', { name: 'dataset', kind: 'string', doc: 'The name of the table, view or incremental table being tested.' }],
            ['filename', { name: 'filename', kind: 'string', doc: 'The file this test is defined in.' }],
            ['tags', { name: 'tags', kind: 'array', doc: 'Tags applied to the test.' }],
        ]);
    }

    keys.set('type', typeKeyInfo);

    if (messageName) {
        for (const [legacyName, protoName] of Object.entries(legacyAliases)) {
            const target = keys.get(protoName);
            if (target) {
                keys.set(legacyName, {
                    ...target,
                    ...keyExtras[legacyName],
                    name: legacyName,
                    aliasOf: protoName,
                    doc: `${target.doc} Equivalent to \`${protoName}\`.`.trim(),
                });
            }
        }
    }

    const bigqueryKeys = legacyBigQueryKeys[type];
    if (bigqueryKeys) {
        keys.set('bigquery', { name: 'bigquery', kind: 'object', doc: keyExtras.bigquery.doc ?? '' });
    }

    const onSchemaChange = keys.get('onSchemaChange');
    if (onSchemaChange) {
        keys.set('onSchemaChange', { ...onSchemaChange, kind: 'string', enumValues: enumValuesFor('ActionConfig.OnSchemaChange'), enumCaseInsensitive: true });
    }
    const incrementalStrategy = keys.get('incrementalStrategy');
    if (incrementalStrategy) {
        keys.set('incrementalStrategy', { ...incrementalStrategy, kind: 'string', enumValues: enumValuesFor('ActionConfig.IncrementalStrategy', 'INCREMENTAL_STRATEGY_'), enumCaseInsensitive: true });
    }

    for (const [name, info] of keys) {
        keys.set(name, sqlxKind(info));
    }

    topLevelCache.set(type, keys);
    return keys;
}

/**
 * Resolves the key set for an object at `path` inside the config block, where `path` lists the
 * keys leading to the object (e.g. `[]` for the top level, `['assertions']`, `['columns', 'user_id']`).
 * Returns undefined when the object's keys are free form or unknown.
 */
export function getKeySetAtPath(type: SqlxActionType, path: string[]): KeySet | undefined {
    if (path.length === 0) {
        return getTopLevelKeys(type);
    }
    const [head, ...rest] = path;
    const topLevel = getTopLevelKeys(type);
    if (!topLevel.has(head)) {
        return undefined;
    }

    if (head === 'bigquery') {
        if (rest.length === 0) {
            const bigqueryKeys = legacyBigQueryKeys[type] ?? [];
            const keys: KeySet = new Map();
            for (const key of bigqueryKeys) {
                const info = topLevel.get(key) ?? getTopLevelKeys('incremental').get(key);
                if (info) {
                    keys.set(key, info);
                }
            }
            return keys;
        }
        return getKeySetAtPath(type, rest);
    }

    if (head === 'columns') {
        // columns -> <column name> -> descriptor -> columns -> <column name> -> descriptor ...
        let remaining = rest;
        while (remaining.length > 0) {
            // remaining[0] is a column name
            if (remaining.length === 1) {
                return COLUMN_DESCRIPTOR_KEYS;
            }
            if (remaining[1] !== 'columns') {
                return undefined;
            }
            remaining = remaining.slice(2);
        }
        return undefined;
    }

    const nested = nestedKeySets[head];
    if (nested && rest.length === 0) {
        return nested();
    }
    return undefined;
}

/** Looks up a key in the object at `path`. */
export function getKeyInfo(type: SqlxActionType, path: string[], key: string): KeyInfo | undefined {
    return getKeySetAtPath(type, path)?.get(key);
}

/** All action types for which `key` is allowed at `path`. */
export function typesAllowingKey(path: string[], key: string): SqlxActionType[] {
    return SQLX_ACTION_TYPES.filter(type => getKeySetAtPath(type, path)?.has(key));
}

/** Union of the keys allowed at `path` across every action type. */
export function allKnownKeysAtPath(path: string[]): KeySet {
    const union: KeySet = new Map();
    for (const type of SQLX_ACTION_TYPES) {
        for (const [name, info] of getKeySetAtPath(type, path) ?? []) {
            if (!union.has(name)) {
                union.set(name, info);
            }
        }
    }
    return union;
}

export function isSqlxActionType(value: string): value is SqlxActionType {
    return (SQLX_ACTION_TYPES as readonly string[]).includes(value);
}
