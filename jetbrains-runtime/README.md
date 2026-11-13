# OPUROM JetBrains runtime plugin

This subproject is a real compiled IntelliJ Platform plugin. It is separate from the [JetBrains metadata](../jetbrains/README.md) directory. Java sources compile against the IntelliJ SDK in the preferred Gradle build, or against local API stubs on the javac compiler classpath in the documented fallback. JDK 21 is the compiler toolchain; both builds emit Java 17 bytecode because ideaIC 2023.3.6 requires it. Stub classes are never packaged into the plugin JAR.

## Contents

- `settings.gradle` and `build.gradle`: Gradle 8.7, JDK 21, `org.jetbrains.intellij` 1.17.4, ideaIC `2023.3.6`, and a `buildPlugin` distributable ZIP.
- `src/main/resources/META-INF/plugin.xml`: plugin id, name, vendor, `idea-version`, dependencies, `com.intellij.modules.platform`/`lang`, OPUROM file type and language syntax highlighter, custom grammar and LSP client extension points, LSP startup activity and service.
- `src/main/resources/textmate/opurom.tmLanguage.json`: bundled OPUROM grammar resource used by the syntax highlighter.
- `src/main/java/opurom/jetbrains/`: language, file type, lexer, syntax highlighter, startup activity, grammar extension, LSP client manager, JSON parser, diagnostics parser, framed LSP client and a standalone LSP probe.
- `verify.mjs`: zero-dependency Node ZIP verifier using `unzip -l` and `unzip -p`.
- `build.mjs`: zero-dependency javac/JAR/ZIP fallback builder.
- `validate.mjs`: zero-dependency source, script and artifact checks used by the repository validator.
- `fixtures/fake-lsp-server.mjs`: deterministic stdio LSP server used by the Node test suite.

## Build

Required toolchain: **JDK 21** (the compiler) and **Gradle 8.7 or newer** (the SDK build).
Both builds emit Java 17 bytecode because ideaIC 2023.3.6 requires it.

Preferred SDK-based build from this directory:

```sh
export JAVA_HOME=<your JDK 21 home>
export GRADLE_USER_HOME="$PWD/.gradle-home"
export TMPDIR="$GRADLE_USER_HOME/tmp"
mkdir -p "$TMPDIR"
./gradlew --no-daemon buildPlugin
```

If your checkout has no Gradle wrapper, use a locally installed Gradle 8.7+ instead:

```sh
export JAVA_HOME=<your JDK 21 home>
gradle --no-daemon buildPlugin
```

The fallback builder reads the same JDK 21 toolchain from `OPR_JDK_HOME` or `JAVA_HOME`:

```sh
export OPR_JDK_HOME=<your JDK 21 home>
node build.mjs
```

The expected artifact is `build/distributions/opurom-jetbrains-0.1.0.zip`. The ZIP contains a plugin directory with `lib/`, loose compiled `.class` files, a plugin JAR, `plugin.xml` and the `textmate/` grammar resource.

If the IntelliJ SDK cannot be downloaded, the fallback builder is:

```sh
node build.mjs
```

The fallback artifact is `build/fallback/opurom-jetbrains-0.1.0.zip`. It compiles the Java sources with JDK 21 `javac`, creates a JAR with `META-INF/plugin.xml`, and assembles a real plugin ZIP. It never reports a fake Gradle success. The concrete SDK failure reason for this checkout is recorded below in the build outcome.

## Verify

From the repository root:

```sh
node jetbrains-runtime/verify.mjs
node scripts/validate.mjs
node --test
```

`verify.mjs` prefers the Gradle ZIP, accepts a valid fallback ZIP when Gradle is unavailable, and exits 0 only when `unzip -l` shows `lib/`, compiled classes, `plugin.xml`, the grammar resource and a JAR whose contents include `META-INF/plugin.xml`. The Node test suite also spawns the compiled `LspProbe` class against a fake stdio server to prove `Content-Length` framing, `didOpen`, `didChange` and `publishDiagnostics` parsing.

## Build outcome

The SDK-based Gradle build succeeded. Gradle 8.7 running on JDK 21.0.13+9 resolved `org.jetbrains.intellij` 1.17.4 and ideaIC 2023.3.6, compiled all 15 Java sources, and `buildPlugin` produced `build/distributions/opurom-jetbrains-0.1.0.zip`. The first run emitted a `verifyPluginConfiguration` warning because Java 21 bytecode is incompatible with build 233; the final build uses JDK 21 with Java 17 bytecode (`major version: 61`) and that warning is gone. `verify.mjs` selected the Gradle ZIP: 24 outer entries, 16 loose `lib/` class files, `plugin.xml`, the grammar resource, and a 23-entry JAR with `META-INF/plugin.xml`. The final ZIP SHA-256 is `0068eb2dd55791390f5f3c94bd14805c3f8f542e3b530f3acf8c6dcd67140a06`.

The `build.mjs` fallback was also exercised with `javac --release 17` and produced `build/fallback/opurom-jetbrains-0.1.0.zip`; it is not the artifact selected by `verify.mjs`. No IntelliJ SDK download failure occurred, so no fallback failure reason applies and there is no fake Gradle success.

## Verification scope

The plugin archive was not loaded inside a running IntelliJ IDE. The startup activity starts a
real LSP session; the Java protocol client is tested outside the IDE.
