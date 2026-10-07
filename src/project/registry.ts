import { Backend, BackendPart, backendParts } from '../backend';
import { DataformBackend } from '../backend/dataform/backend';
import { DbtBackend } from '../backend/dbt';
import { BackendName, detectProjects, detectWorkspaceProjects, FileBackendHints, Project, projectForFile, ProjectForFile } from './detection';

/*
 * The Projects of a window and what each one last compiled to. No `vscode` import: the host (./index.ts) feeds it the
 * workspace folders and the active file.
 */

/** A Project and the state the extension keeps for it */
export class ProjectState implements Project {
    /**
     * @param dataformBackend The Backend of a Dataform Project, which holds what it last compiled to
     * @param dbtBackend The Backend of a dbt Project, likewise
     */
    constructor(
        public readonly root: string,
        public readonly backend: BackendName,
        public readonly dataformBackend?: DataformBackend,
        public readonly dbtBackend?: DbtBackend,
    ) {}

    /** Which optional parts the Project's Backend has: what the host shows controls for */
    get parts(): Record<BackendPart, boolean> {
        const backend: Backend<never> | undefined = this.dataformBackend ?? this.dbtBackend;
        return backend ? backendParts(backend) : { runner: false, changes: false };
    }

    /**
     * How many compile results the Project has had. What is shown of a Project names the compile it came from, so
     * that something worked out from an earlier one can be told apart and dropped. 0 before the first.
     */
    compileNumber = 0;
}

/** A Dataform Backend that holds a compile result and cannot compile, for a registry made without the host */
const holdOnly = () => new DataformBackend(() => Promise.reject(new Error('This registry was given no way to compile')));

const keyOf = (project: Project) => `${project.backend}:${project.root}`;

export class ProjectRegistry {
    private states = new Map<string, ProjectState>();
    private lastActive: ProjectState | undefined;

    /** @param createDataformBackend Makes the Backend of each Dataform Project found */
    constructor(private readonly createDataformBackend: () => DataformBackend = holdOnly) {}

    private newState(project: Project): ProjectState {
        return project.backend === 'dataform'
            ? new ProjectState(project.root, project.backend, this.createDataformBackend())
            : new ProjectState(project.root, project.backend, undefined, new DbtBackend());
    }

    /** Every Project of the window, in workspace-folder order */
    get projects(): ProjectState[] {
        return [...this.states.values()];
    }

    /**
     * Looks for Projects at the roots of `workspaceFolders`. A Project that is still there keeps its state; one that is
     * gone is dropped.
     */
    refresh(workspaceFolders: readonly string[]): ProjectState[] {
        const next = new Map<string, ProjectState>();
        for (const project of detectWorkspaceProjects(workspaceFolders)) {
            next.set(keyOf(project), this.states.get(keyOf(project)) ?? this.newState(project));
        }
        this.states = next;
        if (this.lastActive && !next.has(keyOf(this.lastActive))) {
            this.lastActive = undefined;
        }
        return this.projects;
    }

    /** The Project of `backend` rooted at `root`, if there is one */
    find(root: string, backend: BackendName): ProjectState | undefined {
        return this.states.get(keyOf({ root, backend }));
    }

    /**
     * As `find`, but looks at `root` itself when the Project is not known yet, e.g. a settings file created since the
     * last refresh, or a folder compiled before any refresh.
     */
    ensure(root: string, backend: BackendName): ProjectState | undefined {
        const known = this.find(root, backend);
        if (known) {
            return known;
        }
        const detected = detectProjects(root).find((project) => project.backend === backend);
        if (!detected) {
            return undefined;
        }
        const state = this.newState(detected);
        this.states.set(keyOf(detected), state);
        return state;
    }

    /** The Project a file belongs to */
    forFile(filePath: string, hints: FileBackendHints = {}): ProjectForFile {
        return projectForFile(this.projects, filePath, hints);
    }

    /**
     * Tells the registry which file has focus. A file inside a Project makes that Project the active one; any other
     * file leaves the active Project as it was. Returns whether the active Project changed.
     */
    noteActiveFile(filePath: string, hints: FileBackendHints = {}): boolean {
        const found = this.forFile(filePath, hints);
        if (found.kind !== 'project') {
            return false;
        }
        const before = this.active;
        this.lastActive = found.project as ProjectState;
        return this.active !== before;
    }

    /** Makes `project` the active one, as the user picking it does */
    activate(project: ProjectState) {
        if (this.states.get(keyOf(project)) === project) {
            this.lastActive = project;
        }
    }

    /**
     * The Project commands act on: the one whose file last had focus, or the only Project when there is just one.
     * Undefined when there are several and none has had focus yet, or when there are none.
     */
    get active(): ProjectState | undefined {
        if (this.lastActive) {
            return this.lastActive;
        }
        return this.states.size === 1 ? this.projects[0] : undefined;
    }
}
