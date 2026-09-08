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

// Versión chica del mismo botón, para la pantalla de bloqueo -- pedido
// explícito del usuario ("está muy grande, ¿no podría ser más chico?"):
// el widget de Inicio (arriba) ya es el tamaño mínimo que existe ahí
// (systemSmall, 2x2 íconos); lo más chico que hay en todo iOS es un widget
// de pantalla de bloqueo (accessoryCircular/accessoryRectangular), pero esas
// familias solo existen desde iOS 16 -- por eso viven en un Widget aparte,
// gateado con @available, en vez de meterlas al de arriba.
//
// La pantalla de bloqueo se pinta en un solo color (vibrancy) que pone el
// propio sistema -- cualquier imagen con detalle (como el logo a color del
// widget de Inicio) se vería como una mancha ilegible ahí. Por eso usa un
// símbolo de sistema (SF Symbol) en vez del logo, y nada de fondo/color
// propio (widgetAccentable delega el tinte real al sistema).
@available(iOS 16.0, *)
struct RegistrarGastoLockScreenEntry: TimelineEntry {
  let date: Date
}

@available(iOS 16.0, *)
struct RegistrarGastoLockScreenProvider: TimelineProvider {
  func placeholder(in context: Context) -> RegistrarGastoLockScreenEntry {
    RegistrarGastoLockScreenEntry(date: Date())
  }

  func getSnapshot(in context: Context, completion: @escaping (RegistrarGastoLockScreenEntry) -> Void) {
    completion(RegistrarGastoLockScreenEntry(date: Date()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<RegistrarGastoLockScreenEntry>) -> Void) {
    completion(Timeline(entries: [RegistrarGastoLockScreenEntry(date: Date())], policy: .never))
  }
}

@available(iOS 16.0, *)
struct RegistrarGastoLockScreenView: View {
  @Environment(\.widgetFamily) private var family

  var body: some View {
    Group {
      if family == .accessoryCircular {
        Image(systemName: "plus.circle.fill")
          .font(.system(size: 22, weight: .semibold))
      } else {
        // accessoryRectangular
        HStack(spacing: 5) {
          Image(systemName: "plus.circle.fill")
          Text("Registrar gasto")
            .font(.system(size: 13, weight: .semibold))
            .lineLimit(1)
        }
      }
    }
    .widgetAccentable()
    .widgetURL(URL(string: "https://www.moneyfreak.app/?widget=gasto"))
  }
}

@available(iOS 16.0, *)
struct RegistrarGastoLockScreenWidget: Widget {
  let kind: String = "RegistrarGastoLockScreenWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: RegistrarGastoLockScreenProvider()) { _ in
      RegistrarGastoLockScreenView()
    }
    .configurationDisplayName("Registrar gasto")
    .description("Ícono chico para la pantalla de bloqueo -- un toque abre Money Freak directo en Registrar gasto.")
    .supportedFamilies([.accessoryCircular, .accessoryRectangular])
  }
}

// El widget de Inicio funcionaba confirmado (build 5); en cuanto se agregó
// el de pantalla de bloqueo (build 6) el usuario dejó de encontrar CUALQUIER
// widget en su iPhone -- ni el nuevo ni el de Inicio que ya le funcionaba,
// incluso después de borrar la app y reinstalarla de cero. Eso apunta a que
// algo en el segundo Widget está tumbando el proceso de la extensión
// completa al arrancar (WidgetKit registra los widgets de un mismo binario
// juntos -- si ese proceso truena, no se registra ninguno). Sin acceso a
// una Mac no hay forma de ver el crash log del lado de Apple/iOS desde acá,
// así que se aísla quitando el de pantalla de bloqueo del bundle (se deja
// el código, solo no se registra) para confirmar en un build limpio si el
// de Inicio vuelve a aparecer solo. Si vuelve, el bug está en el segundo
// Widget y se retoma desde cero con más cuidado; si NO vuelve, el problema
// nunca fue el código nuevo.
@main
struct RegistrarGastoWidgetBundle: WidgetBundle {
  var body: some Widget {
    RegistrarGastoWidget()
  }
}
