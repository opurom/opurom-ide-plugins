import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const artifactName = 'opurom-jetbrains-0.1.0.zip';
const modulePath = fileURLToPath(import.meta.url);

// The JDK 21 toolchain comes from OPR_JDK_HOME or JAVA_HOME; without either,
// the plain tool name is used so the host PATH decides.
export function jdkTool(name) {
  const homes = [
    process.env.OPR_JDK_HOME,
    process.env.JAVA_HOME
  ];
  for (const home of homes) {
    if (!home) continue;
    const tool = path.join(home, 'bin', name);
    if (fs.existsSync(tool)) return tool;
  }
  return name;
}

// True when a JDK 21 toolchain is reachable through OPR_JDK_HOME, JAVA_HOME or PATH.
export function hasJdk() {
  const probe = spawnSync(jdkTool('javac'), ['-version'], { encoding: 'utf8' });
  return probe.status === 0 && /javac 21/.test(String(probe.stderr || probe.stdout));
}

export function artifactCandidates() {
  return [
    path.join(base, 'build', 'distributions', artifactName),
    path.join(base, 'build', 'fallback', artifactName)
  ];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options
  });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) {
    const details = String(result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status})${details ? `: ${details}` : ''}`);
  }
  return result;
}

function javaFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...javaFiles(full));
    else if (entry.name.endsWith('.java')) files.push(full);
  }
  return files;
}

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

const stubs = {
  'com/intellij/lang/Language.java': `package com.intellij.lang;
public class Language {
  public Language(String id) {}
}
`,
  'com/intellij/openapi/fileTypes/LanguageFileType.java': `package com.intellij.openapi.fileTypes;
import com.intellij.lang.Language;
import javax.swing.Icon;
public abstract class LanguageFileType {
  protected LanguageFileType(Language language) {}
  public abstract String getName();
  public abstract String getDescription();
  public abstract String getDefaultExtension();
  public abstract Icon getIcon();
}
`,
  'com/intellij/openapi/fileTypes/SyntaxHighlighter.java': `package com.intellij.openapi.fileTypes;
import com.intellij.lexer.Lexer;
import com.intellij.openapi.editor.colors.TextAttributesKey;
import com.intellij.psi.tree.IElementType;
public interface SyntaxHighlighter {
  Lexer getHighlightingLexer();
  TextAttributesKey[] getTokenHighlights(IElementType tokenType);
}
`,
  'com/intellij/openapi/fileTypes/SyntaxHighlighterFactory.java': `package com.intellij.openapi.fileTypes;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.VirtualFile;
public abstract class SyntaxHighlighterFactory {
  public abstract SyntaxHighlighter getSyntaxHighlighter(Project project, VirtualFile virtualFile);
}
`,
  'com/intellij/openapi/editor/colors/TextAttributesKey.java': `package com.intellij.openapi.editor.colors;
public final class TextAttributesKey {
  private TextAttributesKey() {}
  public static TextAttributesKey createTextAttributesKey(String name) { return new TextAttributesKey(); }
}
`,
  'com/intellij/openapi/project/Project.java': `package com.intellij.openapi.project;
public interface Project {
  String getBasePath();
}
`,
  'com/intellij/openapi/vfs/VirtualFile.java': `package com.intellij.openapi.vfs;
public interface VirtualFile {}
`,
  'com/intellij/openapi/startup/StartupActivity.java': `package com.intellij.openapi.startup;
import com.intellij.openapi.project.Project;
public interface StartupActivity {
  void runActivity(Project project);
}
`,
  'com/intellij/lexer/Lexer.java': `package com.intellij.lexer;
public interface Lexer {}
`,
  'com/intellij/lexer/LexerBase.java': `package com.intellij.lexer;
import com.intellij.psi.tree.IElementType;
public abstract class LexerBase implements Lexer {
  public abstract void start(CharSequence buffer, int startOffset, int endOffset, int initialState);
  public abstract int getState();
  public abstract IElementType getTokenType();
  public abstract int getTokenStart();
  public abstract int getTokenEnd();
  public abstract CharSequence getBufferSequence();
  public abstract int getBufferEnd();
  public abstract void advance();
}
`,
  'com/intellij/psi/tree/IElementType.java': `package com.intellij.psi.tree;
import com.intellij.lang.Language;
public class IElementType {
  public IElementType(String debugName, Language language) {}
}
`
};

export function buildFallback() {
  const buildRoot = path.join(base, 'build');
  fs.mkdirSync(buildRoot, { recursive: true });
  const temp = fs.mkdtempSync(path.join(buildRoot, 'fallbuild-'));
  const stubSource = path.join(temp, 'stub-source');
  const stubClasses = path.join(temp, 'stub-classes');
  const classes = path.join(temp, 'classes');
  const stageParent = path.join(temp, 'stage');
  const stage = path.join(stageParent, 'opurom-jetbrains-runtime');
  const resources = path.join(base, 'src', 'main', 'resources');
  const sources = javaFiles(path.join(base, 'src', 'main', 'java'));

  for (const [relative, source] of Object.entries(stubs)) {
    const file = path.join(stubSource, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  fs.mkdirSync(stubClasses, { recursive: true });
  fs.mkdirSync(classes, { recursive: true });
  run(jdkTool('javac'), ['--release', '17', '-d', stubClasses, ...javaFiles(stubSource)]);
  run(jdkTool('javac'), ['--release', '17', '-cp', stubClasses, '-d', classes, ...sources]);

  fs.mkdirSync(path.join(stage, 'lib'), { recursive: true });
  fs.copyFileSync(path.join(resources, 'META-INF', 'plugin.xml'), path.join(stage, 'plugin.xml'));
  fs.cpSync(path.join(resources, 'textmate'), path.join(stage, 'textmate'), { recursive: true });
  const jarPath = path.join(stage, 'lib', 'opurom-jetbrains-runtime-0.1.0.jar');
  run(jdkTool('jar'), ['--create', '--file', jarPath, '-C', classes, '.', '-C', resources, '.']);
  copyTree(classes, path.join(stage, 'lib'));

  const tempZip = path.join(temp, artifactName);
  run('zip', ['-q', '-X', '-r', tempZip, 'opurom-jetbrains-runtime'], { cwd: stageParent });
  const finalZip = path.join(buildRoot, 'fallback', artifactName);
  fs.mkdirSync(path.dirname(finalZip), { recursive: true });
  fs.renameSync(tempZip, finalZip);
  fs.writeFileSync(
    path.join(path.dirname(finalZip), 'BUILD_MODE.txt'),
    'javac fallback: IntelliJ SDK-based Gradle build unavailable; archive NOT loaded inside a running IntelliJ IDE.\n'
  );

  const resolvedTemp = path.resolve(temp);
  const allowedRoot = path.resolve(buildRoot) + path.sep;
  if (!resolvedTemp.startsWith(allowedRoot)) throw new Error(`refusing to remove ${resolvedTemp}`);
  fs.rmSync(resolvedTemp, { recursive: true, force: true });

  console.log(`PASS fallback javac (${sources.length} Java sources, stub APIs excluded)`);
  console.log(`PASS fallback jar and ZIP (${finalZip})`);
  return finalZip;
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  try {
    const zipPath = buildFallback();
    console.log(`PASS fallback plugin ZIP (${zipPath})`);
  } catch (error) {
    console.error(`FAIL fallback plugin build: ${error.message}`);
    process.exitCode = 1;
  }
}
