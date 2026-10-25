import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.PrintStream;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;

import org.eclipse.bpmn2.BaseElement;
import org.eclipse.bpmn2.documentacional.BpmnPool;
import org.eclipse.bpmn2.documentacional.BpmnSwimLane;
import org.eclipse.emf.common.util.EList;
import org.eclipse.emf.common.util.URI;
import org.eclipse.emf.ecore.EObject;
import org.eclipse.emf.ecore.resource.Resource;
import org.eclipse.emf.ecore.resource.ResourceSet;
import org.eclipse.emf.ecore.resource.impl.ResourceSetImpl;
import org.eclipse.emf.ecore.xmi.XMLResource;
import org.eclipse.emf.ecore.xmi.impl.XMIResourceFactoryImpl;
import org.eclipse.graphiti.features.IAddFeature;
import org.eclipse.graphiti.features.IFeature;
import org.eclipse.graphiti.features.context.IAddContext;
import org.eclipse.graphiti.features.context.IContext;
import org.eclipse.graphiti.mm.pictograms.Diagram;
import org.eclipse.graphiti.platform.IDiagramBehavior;
import org.eclipse.graphiti.services.Graphiti;

import com.fluig.bpm.xmlreader.GenericXMLDecoder;
import com.fluig.bpm.xmlreader.UnknownXStreamItem;
import com.totvs.tds.ecm.designer.diagram.bpmn.TotvsBpmnDiagramTypeProvider;
import com.totvs.tds.ecm.designer.eclipse.ui.ImportFromEcm3ToBpmn2FileReader;

/**
 * Ponte de linha de comando para o importador ECM30 -> .process do Fluig Studio (o mesmo
 * "importar processo do servidor" do Eclipse), sem workbench.
 *
 *   ImportadorBridge <entrada.ecm30.xml> <pastaSaida> <processId> <servidor>
 *
 * Grava <pastaSaida>/workflow/diagrams/<processId>.process; os scripts de evento e os literais saem
 * em <pastaSaida>/workflow/scripts e workflow/literals (ProjectUtils substituto, -Dponte.raiz).
 * A última linha do stdout é um JSON com o resultado; o resto do que o Studio imprime é descartado.
 */
public final class ImportadorBridge {
    private ImportadorBridge() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 4) {
            System.err.println("Uso: ImportadorBridge <entrada.ecm30.xml> <pastaSaida> <processId> <servidor>");
            System.exit(2);
        }
        String xml = new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8);
        File raiz = new File(args[1]).getAbsoluteFile();
        String processId = args[2];
        String servidor = args[3];
        System.setProperty("ponte.raiz", raiz.getPath());
        File saida = new File(new File(new File(raiz, "workflow"), "diagrams"), processId + ".process");
        saida.getParentFile().mkdirs();

        // o GenericXMLDecoder ecoa o XML inteiro no stdout: só o JSON final pode sair por ali
        PrintStream stdout = System.out;
        System.setOut(new PrintStream(new ByteArrayOutputStream(), true, "UTF-8"));

        GenericXMLDecoder decoder = new GenericXMLDecoder();
        decoder.decodeXML(xml);
        List<String> desconhecidos = new ArrayList<String>();
        for (UnknownXStreamItem i : decoder.getUnknownItems()) desconhecidos.add(i.getId());

        ResourceSet rs = new ResourceSetImpl();
        rs.getResourceFactoryRegistry().getExtensionToFactoryMap().put("process", new XMIResourceFactoryImpl());
        Resource recurso = rs.createResource(URI.createFileURI(saida.getPath()));

        Diagram diagrama = Graphiti.getPeCreateService().createDiagram("BPMNdiagram", processId, 10, true);
        recurso.getContents().add(diagrama);

        TotvsBpmnDiagramTypeProvider dtp = new TotvsBpmnDiagramTypeProvider();
        dtp.init(diagrama, comportamentoSemEditor());

        ImportFromEcm3ToBpmn2FileReader leitor = new ImportFromEcm3ToBpmn2FileReader(null, xml);
        leitor.setProcessName(processId);
        leitor.setDiagram(diagrama);
        leitor.setFeatureProvider(dtp.getFeatureProvider());
        HashSet<String> subprocessos = leitor.readBpmn(servidor);
        if (subprocessos == null) {
            // o Studio devolve null quando o processo não tem nenhuma atividade
            System.setOut(stdout);
            stdout.println("{\"ok\":false,\"codigo\":\"vazio\",\"motivo\":\"processo sem atividades\"}");
            stdout.flush();
            return;
        }

        ordenarPorNumero(recurso.getContents());

        Map<Object, Object> opcoes = new HashMap<Object, Object>();
        opcoes.put(XMLResource.OPTION_ENCODING, "ASCII");
        recurso.save(opcoes);

        System.setOut(stdout);
        StringBuilder j = new StringBuilder("{\"ok\":true");
        j.append(",\"process\":").append(texto(saida.getPath()));
        j.append(",\"formId\":").append(leitor.getFormId() == null ? "null" : leitor.getFormId().toString());
        j.append(",\"aviso\":").append(leitor.getWarning() == null ? "null" : texto(leitor.getWarning()));
        j.append(",\"subprocessos\":").append(lista(new ArrayList<String>(subprocessos)));
        j.append(",\"desconhecidos\":").append(lista(desconhecidos));
        j.append('}');
        stdout.println(j);
        stdout.flush();
    }

    /**
     * O conversor numera raias e pools pela ordem em que aparecem no arquivo, e o Studio os cria na
     * ordem de um HashMap. Reordena-os entre si pelo número do servidor (o id já vem certo).
     */
    private static void ordenarPorNumero(EList<EObject> conteudo) {
        List<Integer> posicoes = new ArrayList<Integer>();
        List<BaseElement> blocos = new ArrayList<BaseElement>();
        for (int i = 0; i < conteudo.size(); i++) {
            EObject o = conteudo.get(i);
            if (o instanceof BpmnSwimLane || o instanceof BpmnPool) {
                posicoes.add(i);
                blocos.add((BaseElement) o);
            }
        }
        List<BaseElement> ordenados = new ArrayList<BaseElement>(blocos);
        Collections.sort(ordenados, new Comparator<BaseElement>() {
            public int compare(BaseElement a, BaseElement b) {
                return Integer.compare(a.getElementSequence(), b.getElementSequence());
            }
        });
        for (int k = 0; k < posicoes.size(); k++) {
            conteudo.move(posicoes.get(k), ordenados.get(k));
        }
    }

    /** IDiagramBehavior sem editor: executeFeature roda a feature direto (sem pilha de comandos); o resto não faz nada. */
    private static IDiagramBehavior comportamentoSemEditor() {
        return (IDiagramBehavior) Proxy.newProxyInstance(
            ImportadorBridge.class.getClassLoader(),
            new Class<?>[] { IDiagramBehavior.class },
            new java.lang.reflect.InvocationHandler() {
                public Object invoke(Object proxy, java.lang.reflect.Method metodo, Object[] a) {
                    if ("executeFeature".equals(metodo.getName())) {
                        IFeature f = (IFeature) a[0];
                        IContext c = (IContext) a[1];
                        if (f instanceof IAddFeature) return ((IAddFeature) f).add((IAddContext) c);
                        f.execute(c);
                        return null;
                    }
                    Class<?> r = metodo.getReturnType();
                    if (r == boolean.class) return Boolean.FALSE;
                    if (r == int.class) return Integer.valueOf(0);
                    if (r == double.class) return Double.valueOf(0d);
                    return null;
                }
            });
    }

    private static String lista(List<String> itens) {
        Collections.sort(itens);
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < itens.size(); i++) {
            if (i > 0) b.append(',');
            b.append(texto(itens.get(i)));
        }
        return b.append(']').toString();
    }

    private static String texto(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c == '\n') b.append("\\n");
            else if (c == '\r') b.append("\\r");
            else if (c == '\t') b.append("\\t");
            else if (c < 0x20 || c > 0x7e) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }
}
