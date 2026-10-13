import type { BackendName } from '../project/detection';
import { Target, isMadeUpTarget } from '../shared/compiledGraph';

/*
 * Where the BigQuery jobs the extension starts for an action run: its dry runs and its previews. Two rules, one for
 * each Backend, decided in xf#53.
 */

/** Where a job runs. An unset project is the credentials' default project; an unset location lets BigQuery pick */
export interface JobPlace {
    projectId?: string;
    location?: string;
}

/** The `gcpProjectId` and `gcpLocation` settings, each unset when empty */
export interface JobSettings {
    gcpProjectId?: string;
    gcpLocation?: string;
}

/**
 * Where the jobs for an action with this Target run.
 *
 * - `gcpProjectId` and `gcpLocation` win when set, for both Backends.
 * - Unset, a dbt action's jobs run in its Target's project, and BigQuery picks the location. An action that builds
 *   nothing has no project of its own and falls back to the credentials' default.
 * - Unset, a Dataform action's jobs run in the credentials' default project, as they always have.
 */
export function jobPlace(backend: BackendName, target: Target, settings: JobSettings): JobPlace {
    const place: JobPlace = {};
    const projectId = settings.gcpProjectId?.trim() || (backend === 'dbt' && !isMadeUpTarget(target) ? target.database : undefined);
    if (projectId) {
        place.projectId = projectId;
    }
    const location = settings.gcpLocation?.trim();
    if (location) {
        place.location = location;
    }
    return place;
}
