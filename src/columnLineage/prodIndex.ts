import { getWorkspaceFolder } from '../utils';
import { compiledJson } from '../project';
import { getProdCompilerOptions, getProdTargets } from '../defer/prodTargets';
import { GraphAction as CompiledAction, lookupProdTarget, prodKey } from '../defer/deferRules';
import { GraphAction, targetFqn } from '../shared/columnLineage/graphLinks';
import { Target } from '../types';

export interface ProdIndex {
    /** The project's actions keyed by Prod Target, or by dev target when they have none */
    index: Map<string, GraphAction>;
    /** The Prod Target of a dev target, or the dev target when it has none */
    toProd: (dev: string) => string;
    /**
     * The Prod Target of a dev target. Undefined when `prodCompilerOptions` is set and nothing in the compile with
     * it matches, so the dev table must not stand in for prod. Without Prod Options it falls back like `toProd`.
     */
    prodTarget: (dev: string) => string | undefined;
}

/** Dev target to Prod Target of every action the prod compile matches */
export function matchProdTargets(actions: CompiledAction[], prodTargets: Map<string, Target>): Map<string, string> {
    const devToProd = new Map<string, string>();
    for (const action of actions) {
        const prod = lookupProdTarget(prodTargets, action);
        if (prod) {
            devToProd.set(targetFqn(action.target), targetFqn(prod));
        }
    }
    return devToProd;
}

/**
 * The index for `devToProd`. `strict`: the Prod Options were set explicitly, so an action they don't match has no
 * Prod Target, rather than its dev target.
 */
export function prodIndexOf(devIndex: Map<string, GraphAction>, devToProd: Map<string, string>, strict: boolean): ProdIndex {
    const toProd = (dev: string) => devToProd.get(dev) ?? dev;
    const index = new Map<string, GraphAction>();
    devIndex.forEach((action, dev) => {
        const fqn = toProd(dev);
        index.set(fqn, { ...action, fqn, dependsOn: action.dependsOn.map(toProd) });
    });
    return { index, toProd, prodTarget: strict ? (dev) => devToProd.get(dev) : toProd };
}

function devIndexOnly(devIndex: Map<string, GraphAction>): ProdIndex {
    return { index: devIndex, toProd: (dev) => dev, prodTarget: (dev) => dev };
}

/**
 * The project's actions keyed by Prod Target, which is where Dataplex has lineage. Uses the dev targets when there
 * are no Prod Options; throws when the prod compile fails.
 */
export async function resolveProdIndex(devIndex: Map<string, GraphAction>): Promise<ProdIndex> {
    const graph = compiledJson();
    const workspaceFolder = await getWorkspaceFolder();
    const prodOptions = workspaceFolder ? getProdCompilerOptions(workspaceFolder) : undefined;
    if (!graph || !workspaceFolder || prodOptions === undefined) {
        return devIndexOnly(devIndex);
    }
    const actions = [...(graph.tables ?? []), ...(graph.operations ?? []), ...(graph.assertions ?? []), ...(graph.declarations ?? [])];
    const prodTargets = await getProdTargets(workspaceFolder, prodOptions, actions.map((action) => prodKey(action)));
    return prodIndexOf(devIndex, matchProdTargets(actions, prodTargets), prodOptions !== '');
}
