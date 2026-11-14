package opurom.jetbrains;

public interface OpuromGrammar {
    boolean matches(String scope, String token);
}
