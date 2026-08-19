package com.miscuentaspro.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

public class RegistrarGastoWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            RemoteViews vistas = new RemoteViews(context.getPackageName(), R.layout.widget_registrar_gasto);

            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.moneyfreak.app/?widget=gasto"));
            intent.setPackage(context.getPackageName());
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

            PendingIntent pendingIntent = PendingIntent.getActivity(
                context, appWidgetId, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            vistas.setOnClickPendingIntent(R.id.widget_raiz, pendingIntent);
            appWidgetManager.updateAppWidget(appWidgetId, vistas);
        }
    }
}
