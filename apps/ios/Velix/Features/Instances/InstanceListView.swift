import SwiftUI

/// Tela "Conta": lista as instâncias logadas, permite trocar a ativa, adicionar
/// uma nova (reabrindo o fluxo do Onboarding como sheet) e remover.
struct InstanceListView: View {
    @Environment(AppSession.self) private var session
    @State private var isAddingInstance = false

    var body: some View {
        NavigationStack {
            List {
                ForEach(session.instanceStore.instances) { instance in
                    Button {
                        session.instanceStore.setActive(instance)
                    } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(instance.displayName)
                                Text(instance.userEmail)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if instance.id == session.instanceStore.activeInstance?.id {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(.tint)
                            }
                        }
                    }
                    .foregroundStyle(.primary)
                }
                .onDelete(perform: removeInstances)
            }
            .navigationTitle("Conta")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        isAddingInstance = true
                    } label: {
                        Label("Adicionar instância", systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $isAddingInstance) {
                AddInstanceView(onFinished: { isAddingInstance = false })
            }
        }
    }

    private func removeInstances(at offsets: IndexSet) {
        // ponytail: não chama DELETE /push/devices/:id aqui — o id do device
        // token local ainda não é guardado em lugar nenhum (isso é do
        // PushManager, Task 10). Quando existir, buscar o id da instância
        // removida antes de `remove(_:)` e chamar o DELETE com o APIClient
        // dela.
        for index in offsets {
            session.instanceStore.remove(session.instanceStore.instances[index])
        }
    }
}

#Preview {
    InstanceListView()
        .environment(AppSession())
}
