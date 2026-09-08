// Widget de iOS para "Registrar gasto" en un toque -- mismo propósito que
// RegistrarGastoWidgetProvider.java en Android: un botón que abre la app
// directo en "Registrar gasto", nada de datos en vivo ni sesión compartida.
//
// No hace falta App Group ni leer nada de Supabase: basta con abrir
// https://www.moneyfreak.app/?widget=gasto -- iOS lo resuelve como
// Universal Link hacia esta misma app (el dominio ya está registrado en
// App.entitlements, com.apple.developer.associated-domains) y el listener
// de appUrlOpen que ya existe en index.html hace el resto (ver ese archivo,
// parte del 2026-08-10).

import WidgetKit
import SwiftUI

struct RegistrarGastoEntry: TimelineEntry {
  let date: Date
}

struct RegistrarGastoProvider: TimelineProvider {
  func placeholder(in context: Context) -> RegistrarGastoEntry {
    RegistrarGastoEntry(date: Date())
  }

  func getSnapshot(in context: Context, completion: @escaping (RegistrarGastoEntry) -> Void) {
    completion(RegistrarGastoEntry(date: Date()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<RegistrarGastoEntry>) -> Void) {
    // Es un botón, no un widget de datos -- una sola entrada que nunca
    // caduca (.never) evita que el sistema le pida refrescos que no
    // necesita.
    let entrada = RegistrarGastoEntry(date: Date())
    completion(Timeline(entries: [entrada], policy: .never))
  }
}

private extension View {
  // iOS 17+ exige containerBackground para el fondo del widget; en
  // versiones antes de esa (el deployment target de este proyecto es
  // 15.0) el fondo se ponía directo en la vista con .background().
  @ViewBuilder
  func fondoDeWidget(_ color: Color) -> some View {
    if #available(iOS 17.0, *) {
      self.containerBackground(color, for: .widget)
    } else {
      self.background(color)
    }
  }
}

struct RegistrarGastoWidgetView: View {
  // Misma paleta invertida que ya usa el ícono de la app (negro con acento
  // crema), consistente con el widget de Android.
  private let colorFondo = Color(red: 0.055, green: 0.055, blue: 0.06)
  private let colorTexto = Color(red: 0.97, green: 0.95, blue: 0.90)

  var body: some View {
    VStack(spacing: 8) {
      Image("LogoWidget")
        .resizable()
        .aspectRatio(contentMode: .fit)
        .frame(width: 32, height: 32)
      Text("+ Registrar\ngasto")
        .font(.system(size: 13, weight: .semibold))
        .foregroundColor(colorTexto)
        .multilineTextAlignment(.center)
        .lineLimit(2)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding(10)
    .fondoDeWidget(colorFondo)
    .widgetURL(URL(string: "https://www.moneyfreak.app/?widget=gasto"))
  }
}

struct RegistrarGastoWidget: Widget {
  let kind: String = "RegistrarGastoWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: RegistrarGastoProvider()) { _ in
      RegistrarGastoWidgetView()
    }
    .configurationDisplayName("Registrar gasto")
    .description("Un toque para abrir Money Freak directo en Registrar gasto.")
    .supportedFamilies([.systemSmall])
  }
}

@main
struct RegistrarGastoWidgetBundle: WidgetBundle {
  var body: some Widget {
    RegistrarGastoWidget()
  }
}
