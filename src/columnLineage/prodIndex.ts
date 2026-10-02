import { logger } from '../logger';
import { getWorkspaceFolder } from '../utils';
import { getProdCompilerOptions, getProdTargets } from '../defer/prodTargets';
import { lookupProdTarget, prodKey } from '../defer/deferRules';
import { GraphAction, targetFqn } from '../shared/columnLineage/graphLinks';

/**
 * The project's actions keyed by Prod Target, which is where Dataplex has lineage. Falls back to the dev
 * targets when there are no Prod Options or the prod compile fails.
 */
export async function indexByProdTarget(devIndex: Map<string, GraphAction>): Promise<{ index: Map<string, GraphAction>; toProd: (dev: string) => string }> {
    const graph = CACHED_COMPILED_DATAFORM_JSON;
    const workspaceFolder = await getWorkspaceFolder();
    const prodOptions = workspaceFolder ? getProdCompilerOptions(workspaceFolder) : undefined;
    if (!graph || !workspaceFolder || prodOptions === undefined) {
        return { index: devIndex, toProd: (dev) => dev };
    }
    try {
        const actions = [...(graph.tables ?? []), ...(graph.operations ?? []), ...(graph.assertions ?? []), ...(graph.declarations ?? [])];
        const prodTargets = await getProdTargets(workspaceFolder, prodOptions, actions.map((action) => prodKey(action)));
        const devToProd = new Map<string, string>();
        for (const action of actions) {
            const prod = lookupProdTarget(prodTargets, action);
            devToProd.set(targetFqn(action.target), prod ? targetFqn(prod) : targetFqn(action.target));
        }
        const index = new Map<string, GraphAction>();
        devIndex.forEach((action, dev) => {
            const fqn = devToProd.get(dev) ?? dev;
            index.set(fqn, { ...action, fqn, dependsOn: action.dependsOn.map((dependency) => devToProd.get(dependency) ?? dependency) });
        });
        return { index, toProd: (dev) => devToProd.get(dev) ?? dev };
    } catch (error: any) {
        logger.error(`Column trace: could not resolve Prod Targets, using dev targets: ${error?.message ?? error}`);
        return { index: devIndex, toProd: (dev) => dev };
    }
}

