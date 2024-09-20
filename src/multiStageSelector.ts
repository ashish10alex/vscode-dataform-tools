import * as vscode from 'vscode';

export async function multiStageSelectionHandler() {
    // First stage selection
    const firstStageOptions = dataformTags;
    const firstStageSelection = await vscode.window.showQuickPick(firstStageOptions, {
      placeHolder: 'Select an option'
    });
  
    if (!firstStageSelection) {
      return; // User cancelled the selection
    }
  
    // Second stage selection based on first stage
    let secondStageOptions: string[];
    if (firstStageSelection) {
      secondStageOptions = ["default", "include dependents", "include dependencies"];
    } else{
      return;
    }
  
    const secondStageSelection = await vscode.window.showQuickPick(secondStageOptions, {
      placeHolder: `select run type`
    });

    if (!secondStageSelection) {
      return; // User cancelled the selection
    }

    // Second stage selection based on first stage
    let thirdStageOptions: string[];
    if (firstStageSelection) {
      thirdStageOptions = ["no", "yes"];
    } else{
      return;
    }

    const thirdStageSelection = await vscode.window.showQuickPick(thirdStageOptions, {
      placeHolder: `full refresh`
    });

    if (!thirdStageSelection){
      return;
    }
  
    // Handle the final selection
    vscode.window.showInformationMessage(`You selected: ${firstStageSelection} > ${secondStageSelection} > ${thirdStageSelection}`);
  }