package com.totvs.tds.ecm.designer.eclipse.preferences;

/**
 * Substituto sem o plugin de UI: toda preferência booleana fica false. No importador só pesa em
 * EDITOR_ADD_LABELS_TO_NEW_SEQUENCEFLOWS (rótulo de ligação sem nome).
 */
public final class BpmnPreferencesUtil {
    private BpmnPreferencesUtil() {
    }

    public static final boolean getBooleanPreference(BpmnPreferences preferencia) {
        return false;
    }

    public static final boolean getBooleanPreference(String preferencia) {
        return false;
    }
}
