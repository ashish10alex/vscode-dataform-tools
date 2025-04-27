import path from "path";
import fs from "fs";

// Helper function to find project root (where package.json is located)
export function findProjectRoot(startDir: string): string {
    let currentDir = startDir;
    
    // Maximum number of directories to traverse up to avoid infinite loops
    const maxDepth = 10;
    let depth = 0;
    
    while (depth < maxDepth) {
        if (fs.existsSync(path.join(currentDir, 'package.json'))) {
            return currentDir;
        }
        
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            // Reached the root of the filesystem
            break;
        }
        
        currentDir = parentDir;
        depth++;
    }
    
    throw new Error('Could not find project root (package.json)');
}