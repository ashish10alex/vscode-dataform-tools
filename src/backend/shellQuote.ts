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
 * Quotes an argument for cmd, which is the shell of the terminal a run is sent to on Windows, so that the program
 * gets it as it is. There are two readers. The program splits its command line by the C runtime's rules: "..." is one
 * argument, a " inside is written \", and backslashes are doubled before a ". cmd reads the line first, and takes
 * & | < > ( ) ^ as its own outside quotes; it does not know \", so with a " inside it loses track of what is quoted,
 * and inside quotes it still expands %NAME%. An argument with a " or a % therefore has every character cmd would
 * read put after a ^, the quotes included, which leaves cmd nothing to interpret.
 */
function windowsQuote(argument: string): string {
    if (argument !== '' && !/[ \t&|<>^()%!;,=@'"{}[\]#]/.test(argument)) {
        return argument;
    }
    const quoted = `"${argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
    return /["%]/.test(argument) ? quoted.replace(/[()%!^"<>&|]/g, '^$&') : quoted;
}

/** The arguments as one command line, quoted for the shell a run is sent to on `platform`: a POSIX shell, or cmd on Windows */
export function shellJoin(args: string[], platform: NodeJS.Platform = process.platform): string {
    return args.map(platform === 'win32' ? windowsQuote : posixQuote).join(' ');
}
