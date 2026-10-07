/*
 * Command lines a user can read, copy and paste into a terminal. A port of xf's internal/backend/cmdrun/shell.go.
 */

/** Single-quotes an argument that a POSIX shell would split or expand */
function posixQuote(argument: string): string {
    if (argument !== '' && !/[ \t"'$`\\*?[\]{}()<>|&;#~]/.test(argument)) {
        return argument;
    }
    return `'${argument.replaceAll("'", `'\\''`)}'`;
}

/**
 * Double-quotes an argument that PowerShell or cmd would split or treat specially; both read "..." the same. Inside
 * double quotes PowerShell still expands $ and `, and the two disagree on escaping a ", so an argument with those is
 * single-quoted instead, as PowerShell (the default in VS Code's terminal on Windows) reads it.
 */
function windowsQuote(argument: string): string {
    if (/[$`"]/.test(argument)) {
        return `'${argument.replaceAll("'", "''")}'`;
    }
    if (argument !== '' && !/[ \t&|<>^()%!;,=@'{}[\]#]/.test(argument)) {
        return argument;
    }
    return `"${argument}"`;
}

/** The arguments as one command line, quoted for the shells of `platform` */
export function shellJoin(args: string[], platform: NodeJS.Platform = process.platform): string {
    return args.map(platform === 'win32' ? windowsQuote : posixQuote).join(' ');
}
