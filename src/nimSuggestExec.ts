/*---------------------------------------------------------
 * Copyright (C) Xored Software Inc. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import os = require('os');
import fs = require('fs');
import net = require('net');
import { getNimSuggestExecPath, getProjectFile, timeoutPromise } from './nimUtils'

let nimSuggestProcessCache: { [project: string]: cp.ChildProcess; } = {};

export enum NimSuggestType {
  /** Suggest from position */
  sug,
  /** Get context from position */
  con,
  /** Get symbol definition from position */
  def,
  /** Get references of symbol from position */
  use,
  /** Get usage of symbol from position in project */
  dus,
  /** Ivoke nim check on file */
  chk,
  /** Returns all tokens in file (symbolType, line, pos, lenght) */
  highlight,
  /** Get outline symbols for file */
  outline
}
/**
 * Parsed string line from nimsuggest utility.
 */
export interface INimSuggestResult {

  /** Three characters indicating the type of returned answer 
   * (e.g. def for definition, sug for suggestion, etc). */
  answerType: string;

  /** Type of the symbol. This can be skProc, skLet, and just
   *  about any of the enums defined in the module compiler/ast.nim. */
  suggest: string;

  /** Full qualitifed path of the symbol.If you are querying a symbol 
   * defined in the proj.nim file, this would have the form proj.symbolName. */
  name: string;

  /** Type / signature.For variables and enums this will contain the type 
   * of the symbol, for procs, methods and templates this will contain the 
   * full unique signature (e.g.proc(File)). */
  type: string;

  /** Full path to the file containing the symbol. */
  path: string;

  /** Line where the symbol is located in the file.Lines start to count at 1. */
  line: number;

  /** Column where the symbol is located in the file.Columns start to count at 0. */
  column: number;

  /** Docstring for the symbol if available or the empty string.
   * To differentiate the docstring from end of answer in server mode, 
   * the docstring is always provided enclosed in double quotes, and if 
   * the docstring spans multiple lines, all following lines of the docstring 
   * will start with a blank space to align visually with the starting quote.
   * //
   * Also, you won't find raw \n characters breaking the one answer per line format.
   * Instead you will need to parse sequences in the form \xHH, where HH 
   * is a hexadecimal value (e.g. newlines generate the sequence \x0A). */
  documentation: string;
}

export function execNimSuggest(suggestType: NimSuggestType, filename: string,
  line: number, column: number, dirtyFile?: string): Promise<INimSuggestResult[]> {
  // return promise with 1 sec timeout
  return timeoutPromise(1000, new Promise<INimSuggestResult[]>((resolve, reject) => {
    var nimSuggestExec = getNimSuggestExecPath();
    // if nimsuggest not found just ignore
    if (!nimSuggestExec) {
      resolve([]);
    }
    var file = getWorkingFile(filename);
    if (!nimSuggestProcessCache[file]) {
      initNimSuggestProcess(file);
    }

    var process = nimSuggestProcessCache[file];

    var str = "";
    var listener = (data) => {
      let chunk: string = data.toString();
      str += chunk;
      if (chunk.trim() === "" || chunk.trim() === ">") {
        process.stdout.removeListener("data", listener);
        if (str.indexOf('> ') >= 0) {
          str = str.substr(str.indexOf('> ') + 2);
          var lines = str.toString().split(os.EOL);
          var result: INimSuggestResult[] = [];
          for (var i = 0; i < lines.length; i++) {
            var parts = lines[i].split('\t');
            if (parts.length === 8) {
              result.push({
                answerType: parts[0],
                suggest: parts[1],
                name: parts[2],
                type: parts[3],
                path: parts[4],
                line: parseInt(parts[5]),
                column: parseInt(parts[6]),
                documentation: parts[7] != '""' ? parts[7] : ""
              });
            }
          }

        }
        // console.log(str);
        // console.log("!!!!!!!!!!!!");
        resolve(result);
      }
    };
    process.stdout.on("data", listener);

    let cmd = NimSuggestType[suggestType] + ' "' + filename + '"' + (dirtyFile ? (';"' + dirtyFile + '"') : "") + ":" + line + ":" + column + "\n";
    process.stdin.write(cmd);
  }));
}

export function closeAllNimSuggestProcesses(): void {
  for (var project in nimSuggestProcessCache) {
    nimSuggestProcessCache[project].kill();
  }
  nimSuggestProcessCache = {};
}

function initNimSuggestProcess(nimProject: string): void {
  let process = cp.spawn(getNimSuggestExecPath(), [nimProject], { cwd: vscode.workspace.rootPath });
  process.stderr.on("data", (data) => {
    console.log("error");
    console.log(data.toString());
  });
  nimSuggestProcessCache[nimProject] = process;
}

function getWorkingFile(filename: string) {
  var config = vscode.workspace.getConfiguration('nim');

  var cwd = vscode.workspace.rootPath;
  filename = vscode.workspace.asRelativePath(filename);
  if (filename.startsWith(path.sep)) {
    filename = filename.slice(1);
  }

  return config["project"] || filename;
}