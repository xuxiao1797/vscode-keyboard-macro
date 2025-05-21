import * as vscode from "vscode";

interface MacroEvent {
  timeOffset: number;
  type: "cursorMove" | "textInput";
  data: any;
}

interface PlayOptions {
  times?: number;
}

class MacroRecorder {
  private context: vscode.ExtensionContext;
  private isRecording = false;
  private startTime = 0;
  private macroEvents: MacroEvent[] = [];
  private startLine = 0; // 记录起始行
  private subscriptions: vscode.Disposable[] = [];
  private hasTimeOffset = true; // 标记是否有时间偏移

  constructor(context: vscode.ExtensionContext, hasTimeOffset: boolean) {
    this.context = context;
    this.hasTimeOffset = hasTimeOffset;
  }

  initSavedData() {
    const savedData =
      this.context.globalState.get<MacroEvent[]>(
        "keyboard-macro-recent-event"
      ) || [];
    this.macroEvents = savedData;
  }

  start() {
    if (this.isRecording) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    this.isRecording = true;
    this.startTime = Date.now();
    this.macroEvents = [];
    this.startLine = editor.selection.active.line; // 记录起始行

    // 监听光标移动
    const cursorDisposable = vscode.window.onDidChangeTextEditorSelection(
      (e) => {
        this.recordCursorMove(e);
      }
    );

    // 监听文本输入
    const textDisposable = vscode.workspace.onDidChangeTextDocument((e) => {
      this.recordTextChange(e);
    });

    this.subscriptions.push(cursorDisposable, textDisposable);
    vscode.window.showInformationMessage("Macro recording started");
  }

  stop() {
    if (!this.isRecording) return;

    this.isRecording = false;
    this.subscriptions.forEach((d) => d.dispose());
    this.subscriptions = [];
    vscode.window.showInformationMessage("Macro recording stopped");
    this.context.globalState.update(
      "keyboard-macro-recent-event",
      this.macroEvents
    );
  }

  async play(options?: PlayOptions) {
    if (!this.macroEvents.length) return;

    const times = options?.times || 1;
    const isValidTimes = Number.isInteger(times) && times > 0;

    if (!isValidTimes) {
      vscode.window.showErrorMessage("Invalid repeat times");
      return;
    }

    for (let i = 0; i < times; i++) {
      await this.playSingleExecution();
    }
    vscode.window.showInformationMessage("Playing macro finished!");
  }

  async playSingleExecution() {
    if (!this.macroEvents.length) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const baseLine = editor.selection.active.line; // 获取当前基准行
    vscode.window.showInformationMessage("Playing macro ...");

    let lastTime = 0;
    for (const event of this.macroEvents) {
      if (this.hasTimeOffset) {
        await new Promise((resolve) =>
          setTimeout(resolve, event.timeOffset - lastTime)
        );
        lastTime = event.timeOffset;
      }
      switch (event.type) {
        case "cursorMove":
          // 计算相对位置
          const targetLine = baseLine + event.data.lineOffset;
          const position = new vscode.Position(
            targetLine,
            event.data.character
          );
          editor.selection = new vscode.Selection(position, position);
          break;

        case "textInput":
          await editor.edit((editBuilder) => {
            // 计算相对范围
            const startLine = baseLine + event.data.range.start.lineOffset;
            const endLine = baseLine + event.data.range.end.lineOffset;

            const range = new vscode.Range(
              new vscode.Position(startLine, event.data.range.start.character),
              new vscode.Position(endLine, event.data.range.end.character)
            );
            editBuilder.replace(range, event.data.text);
          });
          break;
      }
    }
  }

  async playWithTimes() {
    const input = await vscode.window.showInputBox({
      prompt: "repeat times",
      value: "1",
      validateInput: (value) => {
        const num = parseInt(value);
        return num > 0 ? null : "Please enter a positive number";
      },
    });

    if (input) {
      const times = parseInt(input);
      this.play({ times });
    }
  }

  private recordCursorMove(event: vscode.TextEditorSelectionChangeEvent) {
    if (!this.isRecording) return;

    const position = event.selections[0].active;
    this.macroEvents.push({
      timeOffset: Date.now() - this.startTime,
      type: "cursorMove",
      data: {
        lineOffset: position.line - this.startLine, // 存储行偏移
        character: position.character,
      },
    });
  }

  private recordTextChange(event: vscode.TextDocumentChangeEvent) {
    if (!this.isRecording || event.contentChanges.length === 0) return;

    event.contentChanges.forEach((change) => {
      this.macroEvents.push({
        timeOffset: Date.now() - this.startTime,
        type: "textInput",
        data: {
          text: change.text,
          range: {
            start: {
              lineOffset: change.range.start.line - this.startLine, // 行偏移
              character: change.range.start.character,
            },
            end: {
              lineOffset: change.range.end.line - this.startLine, // 行偏移
              character: change.range.end.character,
            },
          },
        },
      });
    });
  }
}

export function activate(context: vscode.ExtensionContext) {
  let isPlaying = false;
  vscode.commands.executeCommand("setContext", "macro.isPlaying", isPlaying);

  const config = vscode.workspace.getConfiguration("keyboard-Macro");
  const enableTimeOffset = config.get("enableTimeOffset");
  const enablePlayMultiple = config.get("enablePlayMultiple");
  const recorder = new MacroRecorder(
    context,
    enableTimeOffset == true ? true : false
  );
  recorder.initSavedData();
  
  context.subscriptions.push(
    vscode.commands.registerCommand("macro.startRecording", () => {
      isPlaying = true;
      vscode.commands.executeCommand("setContext", "macro.isPlaying", true);

      recorder.start();
    }),

    vscode.commands.registerCommand("macro.stopRecording", () => {
      isPlaying = false;
      vscode.commands.executeCommand("setContext", "macro.isPlaying", false);

      recorder.stop();
    }),

    vscode.commands.registerCommand("macro.playMacro", () =>
      enablePlayMultiple ? recorder.playWithTimes() : recorder.play()
    )
  );
}

export function deactivate() {}
