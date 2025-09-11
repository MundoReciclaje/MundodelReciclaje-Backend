// RUTAS DE REPORTES
// Archivo: backend/routes/reportes.js

const express = require('express');
const router = express.Router();

// TEMPORAL - Solo para diagnosticar
router.use((req, res, next) => {
    console.log('🔍 Debug req.db:', req.db ? 'existe' : 'NO EXISTE');
    console.log('🔍 Debug req.db tipo:', typeof req.db);
    if (req.db) {
        console.log('🔍 Métodos disponibles:', Object.keys(req.db));
    }
    next();
});

// Reporte dashboard principal
router.get('/dashboard', async (req, res) => {
    try {
        const { periodo = 'mes' } = req.query;
        
        // Calcular fechas según el período
        const hoy = new Date();
        let fechaInicio;
        
        switch (periodo) {
            case 'dia':
                fechaInicio = new Date(hoy);
                fechaInicio.setHours(0, 0, 0, 0);
                break;
            case 'semana':
                fechaInicio = new Date(hoy);
                fechaInicio.setDate(hoy.getDate() - 7);
                break;
            case 'mes':
                fechaInicio = new Date(hoy);
                fechaInicio.setMonth(hoy.getMonth() - 1);
                break;
            case 'trimestre':
                fechaInicio = new Date(hoy);
                fechaInicio.setMonth(hoy.getMonth() - 3);
                break;
            case 'año':
                fechaInicio = new Date(hoy);
                fechaInicio.setFullYear(hoy.getFullYear() - 1);
                break;
            default:
                fechaInicio = new Date(hoy);
                fechaInicio.setMonth(hoy.getMonth() - 1);
        }

        const fechaInicioStr = fechaInicio.toISOString().split('T')[0];
        const fechaFinStr = hoy.toISOString().split('T')[0];

        // Obtener totales
        const [comprasGenerales, comprasMateriales, ventas, gastos] = await Promise.all([
    req.db.get(`
        SELECT COALESCE(SUM(total_pesos), 0) as total 
        FROM compras_generales 
        WHERE fecha BETWEEN ? AND ?
    `, [fechaInicioStr, fechaFinStr]).then(result => result || { total: 0 }),

    
    
    req.db.get(`
        SELECT COALESCE(SUM(total_pesos), 0) as total 
        FROM compras_materiales 
        WHERE fecha BETWEEN ? AND ?
    `, [fechaInicioStr, fechaFinStr]).then(result => result || { total: 0 }),
    
    req.db.get(`
        SELECT 
            COALESCE(SUM(total_pesos), 0) as total,
            COALESCE(SUM(kilos), 0) as kilos
        FROM ventas 
        WHERE fecha BETWEEN ? AND ?
    `, [fechaInicioStr, fechaFinStr]).then(result => result || { total: 0, kilos: 0 }),
    
    req.db.get(`
        SELECT COALESCE(SUM(valor), 0) as total 
        FROM gastos 
        WHERE fecha BETWEEN ? AND ?
    `, [fechaInicioStr, fechaFinStr]).then(result => result || { total: 0 })
]);

        const totalCompras = (comprasGenerales.total || 0) + (comprasMateriales.total || 0);
        const totalVentas = ventas.total || 0;
        const totalGastos = gastos.total || 0;
        const gananciaBruta = totalVentas - totalCompras;
        const gananciaNeta = gananciaBruta - totalGastos;

        // Materiales más vendidos
        const materialesMasVendidos = await req.db.all(`
            SELECT 
                m.nombre,
                m.categoria,
                SUM(v.kilos) as total_kilos,
                SUM(v.total_pesos) as total_pesos,
                COUNT(*) as transacciones
            FROM ventas v
            JOIN materiales m ON v.material_id = m.id
            WHERE v.fecha BETWEEN ? AND ?
            GROUP BY m.id, m.nombre, m.categoria
            ORDER BY total_pesos DESC
            LIMIT 5
        `, [fechaInicioStr, fechaFinStr]);

        // Evolución diaria
        const evolucionDiaria = await req.db.all(`
            SELECT 
                fecha,
                COALESCE(SUM(total_pesos), 0) as ventas_dia
            FROM ventas
            WHERE fecha BETWEEN ? AND ?
            GROUP BY fecha
            ORDER BY fecha
        `, [fechaInicioStr, fechaFinStr]);

        res.json({
            periodo,
            fecha_inicio: fechaInicioStr,
            fecha_fin: fechaFinStr,
            resumen: {
                total_compras: totalCompras,
                total_ventas: totalVentas,
                total_gastos: totalGastos,
                ganancia_bruta: gananciaBruta,
                ganancia_neta: gananciaNeta,
                margen_ganancia: totalVentas > 0 ? ((gananciaBruta / totalVentas) * 100) : 0,
                total_kilos_vendidos: ventas.kilos || 0
            },
            materiales_mas_vendidos: materialesMasVendidos,
            evolucion_diaria: evolucionDiaria
        });
    } catch (error) {
        console.error('Error generando dashboard:', error);
        res.status(500).json({ error: 'Error generando dashboard' });
    }
});

// Reporte de ganancias detallado
router.get('/ganancias', async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin, agrupar_por = 'dia' } = req.query;

        if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({
                error: 'Fecha de inicio y fin son requeridas'
            });
        }

        let formatoFecha;
        switch (agrupar_por) {
            case 'dia':
                formatoFecha = '%Y-%m-%d';
                break;
            case 'semana':
                formatoFecha = '%Y-%W';
                break;
            case 'mes':
                formatoFecha = '%Y-%m';
                break;
            default:
                formatoFecha = '%Y-%m-%d';
        }

        // Compras por período
        const comprasQuery = `
            SELECT 
                strftime('${formatoFecha}', fecha) as periodo,
                SUM(total_pesos) as total_compras
            FROM (
                SELECT fecha, total_pesos FROM compras_generales 
                WHERE fecha BETWEEN ? AND ?
                UNION ALL
                SELECT fecha, total_pesos FROM compras_materiales 
                WHERE fecha BETWEEN ? AND ?
            )
            GROUP BY periodo
            ORDER BY periodo
        `;

        // Ventas por período
        const ventasQuery = `
            SELECT 
                strftime('${formatoFecha}', fecha) as periodo,
                SUM(total_pesos) as total_ventas,
                SUM(kilos) as total_kilos
            FROM ventas
            WHERE fecha BETWEEN ? AND ?
            GROUP BY periodo
            ORDER BY periodo
        `;

        // Gastos por período
        const gastosQuery = `
            SELECT 
                strftime('${formatoFecha}', fecha) as periodo,
                SUM(valor) as total_gastos
            FROM gastos
            WHERE fecha BETWEEN ? AND ?
            GROUP BY periodo
            ORDER BY periodo
        `;

        const [compras, ventas, gastos] = await Promise.all([
            req.db.all(comprasQuery, [fecha_inicio, fecha_fin, fecha_inicio, fecha_fin]),
            req.db.all(ventasQuery, [fecha_inicio, fecha_fin]),
            req.db.all(gastosQuery, [fecha_inicio, fecha_fin])
        ]);

        // Combinar resultados
        const periodos = new Set([
            ...compras.map(c => c.periodo),
            ...ventas.map(v => v.periodo),
            ...gastos.map(g => g.periodo)
        ]);

        
       

        const reporte = Array.from(periodos).sort().map(periodo => {
            const compra = compras.find(c => c.periodo === periodo);
            const venta = ventas.find(v => v.periodo === periodo);
            const gasto = gastos.find(g => g.periodo === periodo);

            const totalCompras = compra?.total_compras || 0;
            const totalVentas = venta?.total_ventas || 0;
            const totalGastos = gasto?.total_gastos || 0;
            const gananciaBruta = totalVentas - totalCompras;
            const gananciaNeta = gananciaBruta - totalGastos;

            return {
                periodo,
                compras: totalCompras,
                ventas: totalVentas,
                gastos: totalGastos,
                ganancia_bruta: gananciaBruta,
                ganancia_neta: gananciaNeta,
                margen: totalVentas > 0 ? ((gananciaBruta / totalVentas) * 100) : 0,
                kilos_vendidos: venta?.total_kilos || 0
            };
        });

        res.json({
            fecha_inicio,
            fecha_fin,
            agrupacion: agrupar_por,
            reporte
        });
    } catch (error) {
        console.error('Error generando reporte de ganancias:', error);
        res.status(500).json({ error: 'Error generando reporte de ganancias' });
    }
});

// Reporte de materiales
router.get('/materiales', async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin, categoria } = req.query;

        if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({
                error: 'Fecha de inicio y fin son requeridas'
            });
        }

        let whereClause = 'WHERE v.fecha BETWEEN ? AND ?';
        let params = [fecha_inicio, fecha_fin];

        if (categoria) {
            whereClause += ' AND m.categoria = ?';
            params.push(categoria);
        }

        // Reporte de ventas por material
        const ventasPorMaterial = await req.db.all(`
            SELECT 
                m.nombre,
                m.categoria,
                SUM(v.kilos) as total_kilos_vendidos,
                SUM(v.total_pesos) as total_ventas,
                AVG(v.precio_kilo) as precio_promedio_venta,
                COUNT(*) as transacciones_venta,
                MAX(v.precio_kilo) as precio_maximo,
                MIN(v.precio_kilo) as precio_minimo
            FROM ventas v
            JOIN materiales m ON v.material_id = m.id
            ${whereClause}
            GROUP BY m.id, m.nombre, m.categoria
            ORDER BY total_ventas DESC
        `, params);

        // Reporte de compras por material
        const comprasPorMaterial = await req.db.all(`
            SELECT 
                m.nombre,
                m.categoria,
                SUM(cm.kilos) as total_kilos_comprados,
                SUM(cm.total_pesos) as total_compras,
                AVG(cm.precio_kilo) as precio_promedio_compra,
                COUNT(*) as transacciones_compra
            FROM compras_materiales cm
            JOIN materiales m ON cm.material_id = m.id
            WHERE cm.fecha BETWEEN ? AND ?
            ${categoria ? 'AND m.categoria = ?' : ''}
            GROUP BY m.id, m.nombre, m.categoria
            ORDER BY total_compras DESC
        `, categoria ? [fecha_inicio, fecha_fin, categoria] : [fecha_inicio, fecha_fin]);

        // Combinar datos de compras y ventas
        const materialesCompleto = ventasPorMaterial.map(venta => {
            const compra = comprasPorMaterial.find(c => c.nombre === venta.nombre);
            
            return {
                ...venta,
                total_kilos_comprados: compra?.total_kilos_comprados || 0,
                total_compras: compra?.total_compras || 0,
                precio_promedio_compra: compra?.precio_promedio_compra || 0,
                transacciones_compra: compra?.transacciones_compra || 0,
                ganancia_material: venta.total_ventas - (compra?.total_compras || 0),
                margen_material: venta.total_ventas > 0 ? 
                    (((venta.total_ventas - (compra?.total_compras || 0)) / venta.total_ventas) * 100) : 0
            };
        });

        res.json({
            fecha_inicio,
            fecha_fin,
            categoria: categoria || 'Todas',
            materiales: materialesCompleto
        });
    } catch (error) {
        console.error('Error generando reporte de materiales:', error);
        res.status(500).json({ error: 'Error generando reporte de materiales' });
    }
});

// Reporte de promedios de compra por día
router.get('/promedios-compra', async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin } = req.query;

        if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({
                error: 'Fecha de inicio y fin son requeridas'
            });
        }

        // Promedio de compras generales por día
        const promedioGenerales = await req.db.get(`
            SELECT 
                COUNT(DISTINCT fecha) as dias_con_compras,
                COALESCE(SUM(total_pesos), 0) as total_compras,
                COALESCE(AVG(total_pesos), 0) as promedio_por_transaccion,
                COUNT(*) as total_transacciones
            FROM compras_generales
            WHERE fecha BETWEEN ? AND ?
        `, [fecha_inicio, fecha_fin]);

        // Promedio de compras por material por día
        const promedioMateriales = await req.db.get(`
            SELECT 
                COUNT(DISTINCT fecha) as dias_con_compras,
                COALESCE(SUM(total_pesos), 0) as total_compras,
                COALESCE(SUM(kilos), 0) as total_kilos,
                COALESCE(AVG(total_pesos), 0) as promedio_por_transaccion,
                COALESCE(AVG(precio_kilo), 0) as precio_promedio_kilo,
                COUNT(*) as total_transacciones
            FROM compras_materiales
            WHERE fecha BETWEEN ? AND ?
        `, [fecha_inicio, fecha_fin]);

        // Compras por día de la semana
        const comprasPorDia = await req.db.all(`
            SELECT 
                CASE strftime('%w', fecha)
                    WHEN '0' THEN 'Domingo'
                    WHEN '1' THEN 'Lunes'
                    WHEN '2' THEN 'Martes'
                    WHEN '3' THEN 'Miércoles'
                    WHEN '4' THEN 'Jueves'
                    WHEN '5' THEN 'Viernes'
                    WHEN '6' THEN 'Sábado'
                END as dia_semana,
                strftime('%w', fecha) as dia_numero,
                COUNT(*) as transacciones,
                COALESCE(SUM(total_pesos), 0) as total_compras,
                COALESCE(AVG(total_pesos), 0) as promedio_dia
            FROM (
                SELECT fecha, total_pesos FROM compras_generales 
                WHERE fecha BETWEEN ? AND ?
                UNION ALL
                SELECT fecha, total_pesos FROM compras_materiales 
                WHERE fecha BETWEEN ? AND ?
            )
            GROUP BY dia_numero
            ORDER BY dia_numero
        `, [fecha_inicio, fecha_fin, fecha_inicio, fecha_fin]);

        const totalCompras = (promedioGenerales.total_compras || 0) + (promedioMateriales.total_compras || 0);
        const totalTransacciones = (promedioGenerales.total_transacciones || 0) + (promedioMateriales.total_transacciones || 0);
        
        // Calcular días totales en el rango
        const fechaInicioDate = new Date(fecha_inicio);
        const fechaFinDate = new Date(fecha_fin);
        const diasTotales = Math.ceil((fechaFinDate - fechaInicioDate) / (1000 * 60 * 60 * 24)) + 1;

        res.json({
            fecha_inicio,
            fecha_fin,
            resumen: {
                total_compras: totalCompras,
                total_transacciones: totalTransacciones,
                dias_totales: diasTotales,
                promedio_diario: totalCompras / diasTotales,
                promedio_por_transaccion: totalTransacciones > 0 ? (totalCompras / totalTransacciones) : 0
            },
            compras_generales: promedioGenerales,
            compras_materiales: promedioMateriales,
            compras_por_dia_semana: comprasPorDia
        });
    } catch (error) {
        console.error('Error generando reporte de promedios:', error);
        res.status(500).json({ error: 'Error generando reporte de promedios' });
    }
});

// Exportar datos para respaldo
router.get('/export/backup', async (req, res) => {
    try {
        const { tabla, fecha_inicio, fecha_fin } = req.query;

        const tablasPermitidas = ['materiales', 'compras_generales', 'compras_materiales', 'ventas', 'gastos'];
        
        if (tabla && !tablasPermitidas.includes(tabla)) {
            return res.status(400).json({
                error: 'Tabla no válida'
            });
        }

        let datos = {};

        if (!tabla || tabla === 'materiales') {
            datos.materiales = await req.db.all('SELECT * FROM materiales ORDER BY categoria, nombre');
        }

        if (!tabla || tabla === 'compras_generales') {
            let sql = 'SELECT * FROM compras_generales';
            let params = [];
            
            if (fecha_inicio && fecha_fin) {
                sql += ' WHERE fecha BETWEEN ? AND ?';
                params = [fecha_inicio, fecha_fin];
            }
            
            sql += ' ORDER BY fecha DESC';
            datos.compras_generales = await req.db.all(sql, params);
        }

        if (!tabla || tabla === 'compras_materiales') {
            let sql = `
                SELECT 
                    cm.*,
                    m.nombre as material_nombre
                FROM compras_materiales cm
                JOIN materiales m ON cm.material_id = m.id
            `;
            let params = [];
            
            if (fecha_inicio && fecha_fin) {
                sql += ' WHERE cm.fecha BETWEEN ? AND ?';
                params = [fecha_inicio, fecha_fin];
            }
            
            sql += ' ORDER BY cm.fecha DESC';
            datos.compras_materiales = await req.db.all(sql, params);
        }

        if (!tabla || tabla === 'ventas') {
            let sql = `
                SELECT 
                    v.*,
                    m.nombre as material_nombre
                FROM ventas v
                JOIN materiales m ON v.material_id = m.id
            `;
            let params = [];
            
            if (fecha_inicio && fecha_fin) {
                sql += ' WHERE v.fecha BETWEEN ? AND ?';
                params = [fecha_inicio, fecha_fin];
            }
            
            sql += ' ORDER BY v.fecha DESC';
            datos.ventas = await req.db.all(sql, params);
        }

        if (!tabla || tabla === 'gastos') {
            let sql = `
                SELECT 
                    g.*,
                    c.nombre as categoria_nombre
                FROM gastos g
                JOIN categorias_gastos c ON g.categoria_id = c.id
            `;
            let params = [];
            
            if (fecha_inicio && fecha_fin) {
                sql += ' WHERE g.fecha BETWEEN ? AND ?';
                params = [fecha_inicio, fecha_fin];
            }
            
            sql += ' ORDER BY g.fecha DESC';
            datos.gastos = await req.db.all(sql, params);
        }

        res.json({
            fecha_exportacion: new Date().toISOString(),
            filtros: {
                tabla: tabla || 'todas',
                fecha_inicio: fecha_inicio || null,
                fecha_fin: fecha_fin || null
            },
            datos
        });
    } catch (error) {
        console.error('Error exportando datos:', error);
        res.status(500).json({ error: 'Error exportando datos' });
    }
});

module.exports = router;