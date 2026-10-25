package com.fluig.bpm.utils;

import java.io.File;

import org.eclipse.graphiti.mm.pictograms.Diagram;

/**
 * Substituto dos três métodos de ProjectUtils que o importador do Studio chama. O original resolve
 * as pastas pelo workspace do Eclipse; aqui elas ficam sob a raiz em -Dponte.raiz.
 */
public final class ProjectUtils {
    private ProjectUtils() {
    }

    private static File pasta(String relativa) {
        File f = new File(System.getProperty("ponte.raiz", "."), relativa);
        f.mkdirs();
        return f;
    }

    public static String getScriptFileName(String processId, String elementId) {
        return processId + "." + elementId + ".js";
    }

    public static File getScriptsPhysicsFolder(Diagram ignorado) {
        return pasta("workflow/scripts");
    }

    public static File getLiteralsPhysicsFolder(Diagram ignorado) {
        return pasta("workflow/literals");
    }
}
