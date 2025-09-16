// SERVIDOR BACKEND - SISTEMA RECICLAJE CON AUTENTICACIÓN
// Archivo: backend/server.js

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

// Importar base de datos
const Database = require('./config/database');

// Importar middleware de autenticación
const { verificarToken, verificarRol } = require('./middleware/auth');

// Importar rutas
const authRoutes = require('./routes/auth');
const materialesRoutes = require('./routes/materiales');
const comprasRoutes = require('./routes/compras');
const ventasRoutes = require('./routes/ventas');
const gastosRoutes = require('./routes/gastos');
const reportesRoutes = require('./routes/reportes');

const app = express();

const PORT = process.env.PORT || 5000;

const databaseMiddleware = require('./middleware/database');

// Middleware de seguridad
app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// Middleware CORS MEJORADO
app.use(cors({
    origin: [
        'http://localhost:3000',  // ← AGREGADO para desarrollo
        'https://mundodel-reciclaje-deploy.vercel.app'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Logging
app.use(morgan('combined'));

// IMPORTANTE: Middleware para parsear JSON DEBE IR ANTES de las rutas
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware de base de datos (después del parsing JSON)
app.use(databaseMiddleware);

// RUTAS PÚBLICAS (sin autenticación)
app.use('/api/auth', authRoutes);

// Ruta de salud del servidor (pública)
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        version: '1.0.0',
        auth_enabled: true
    });
});

// Debug de tablas CORREGIDO para PostgreSQL
app.get('/api/debug/tables', async (req, res) => {
    try {
        const tables = await req.db.all(`
            SELECT table_name as name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        
        // Obtener estructura de cada tabla
        const tablesWithColumns = {};
        for (const table of tables) {
            try {
                const columns = await req.db.all(`
                    SELECT column_name, data_type, is_nullable 
                    FROM information_schema.columns 
                    WHERE table_name = $1 AND table_schema = 'public'
                    ORDER BY ordinal_position
                `, [table.name]);
                
                tablesWithColumns[table.name] = columns;
            } catch (error) {
                tablesWithColumns[table.name] = { error: error.message };
            }
        }
        
        res.json({
            tables_found: tables.map(t => t.name),
            total_tables: tables.length,
            database_type: 'PostgreSQL',
            tables_structure: tablesWithColumns
        });
    } catch (error) {
        res.status(500).json({ 
            error: error.message,
            database_type: 'PostgreSQL'
        });
    }
});

// Debug usuarios (temporal)
app.get('/api/debug/usuarios', async (req, res) => {
    try {
        const usuarios = await req.db.all('SELECT id, nombre, email, rol, activo, fecha_creacion FROM usuarios');
        res.json(usuarios);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// NUEVO: Debug para verificar columnas de compras
app.get('/api/debug/compras-estructura', async (req, res) => {
    try {
        const columnasGenerales = await req.db.all(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'compras_generales' AND table_schema = 'public'
            ORDER BY ordinal_position
        `);
        
        const columnasMateriales = await req.db.all(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'compras_materiales' AND table_schema = 'public'
            ORDER BY ordinal_position
        `);
        
        res.json({
            compras_generales: columnasGenerales,
            compras_materiales: columnasMateriales,
            tiene_cliente_generales: columnasGenerales.some(col => col.column_name === 'cliente'),
            tiene_cliente_materiales: columnasMateriales.some(col => col.column_name === 'cliente')
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// RUTAS PROTEGIDAS (requieren autenticación)

// Proteger todas las rutas de la API excepto las públicas
app.use('/api/materiales', verificarToken, materialesRoutes);
app.use('/api/compras', verificarToken, comprasRoutes);
app.use('/api/ventas', verificarToken, ventasRoutes);
app.use('/api/gastos', verificarToken, gastosRoutes);
app.use('/api/reportes', verificarToken, reportesRoutes);

// Ruta dashboard (protegida)
app.get('/api/dashboard', verificarToken, async (req, res) => {
    try {
        const db = req.db;
        
        // Obtener estadísticas del último mes
        const fechaInicio = new Date();
        fechaInicio.setMonth(fechaInicio.getMonth() - 1);
        const fechaInicioStr = fechaInicio.toISOString().split('T')[0];
        
        // Total compras del mes CORREGIDO para PostgreSQL
        const totalCompras = await db.get(`
            SELECT 
                COALESCE(
                    (SELECT SUM(total_pesos) FROM compras_generales WHERE fecha >= $1), 0
                ) + COALESCE(
                    (SELECT SUM(total_pesos) FROM compras_materiales WHERE fecha >= $1), 0
                ) as total
        `, [fechaInicioStr]);
        
        // Total ventas del mes
        const totalVentas = await db.get(`
            SELECT COALESCE(SUM(total_pesos), 0) as total 
            FROM ventas 
            WHERE fecha >= $1
        `, [fechaInicioStr]);
        
        // Total gastos del mes
        const totalGastos = await db.get(`
            SELECT COALESCE(SUM(valor), 0) as total 
            FROM gastos 
            WHERE fecha >= $1
        `, [fechaInicioStr]);
        
        // Materiales más vendidos
        const materialesMasVendidos = await db.all(`
            SELECT m.nombre, SUM(v.kilos) as total_kilos, SUM(v.total_pesos) as total_pesos
            FROM ventas v
            JOIN materiales m ON v.material_id = m.id
            WHERE v.fecha >= $1
            GROUP BY m.id, m.nombre
            ORDER BY total_kilos DESC
            LIMIT 5
        `, [fechaInicioStr]);
        
        res.json({
            periodo: 'Último mes',
            fecha_inicio: fechaInicioStr,
            usuario: {
                nombre: req.usuario.nombre,
                rol: req.usuario.rol
            },
            estadisticas: {
                total_compras: totalCompras?.total || 0,
                total_ventas: totalVentas?.total || 0,
                total_gastos: totalGastos?.total || 0,
                ganancia_bruta: (totalVentas?.total || 0) - (totalCompras?.total || 0),
                ganancia_neta: (totalVentas?.total || 0) - (totalCompras?.total || 0) - (totalGastos?.total || 0)
            },
            materiales_mas_vendidos: materialesMasVendidos
        });
        
    } catch (error) {
        console.error('Error obteniendo dashboard:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor',
            message: error.message 
        });
    }
});

// Ruta para gestión de usuarios (solo administradores)
app.get('/api/usuarios', verificarToken, verificarRol(['administrador']), async (req, res) => {
    try {
        const usuarios = await req.db.all(`
            SELECT id, nombre, email, rol, activo, fecha_creacion, ultimo_acceso
            FROM usuarios 
            ORDER BY fecha_creacion DESC
        `);

        res.json(usuarios);
    } catch (error) {
        console.error('Error obteniendo usuarios:', error);
        res.status(500).json({ error: 'Error obteniendo usuarios' });
    }
});

// Activar/desactivar usuario (solo administradores)
app.put('/api/usuarios/:id/toggle', verificarToken, verificarRol(['administrador']), async (req, res) => {
    try {
        const { id } = req.params;

        // No permitir desactivar al propio usuario
        if (parseInt(id) === req.usuario.id) {
            return res.status(400).json({
                error: 'No puedes desactivar tu propia cuenta'
            });
        }

        const usuario = await req.db.get('SELECT activo FROM usuarios WHERE id = $1', [id]);
        
        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const nuevoEstado = !usuario.activo;
        
        await req.db.run(
            'UPDATE usuarios SET activo = $1, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id = $2',
            [nuevoEstado, id]
        );

        res.json({
            message: `Usuario ${nuevoEstado ? 'activado' : 'desactivado'} exitosamente`,
            activo: nuevoEstado
        });
    } catch (error) {
        console.error('Error actualizando usuario:', error);
        res.status(500).json({ error: 'Error actualizando usuario' });
    }
});

// Middleware de manejo de errores
app.use((err, req, res, next) => {
    console.error('Error:', err);
    
    // Error de validación
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Error de validación',
            details: err.message
        });
    }
    
    // Error de base de datos PostgreSQL
    if (err.code && err.code.startsWith('23')) {  // PostgreSQL constraint errors
        return res.status(400).json({
            error: 'Error de restricción de base de datos',
            message: 'Los datos violan las restricciones de la base de datos'
        });
    }
    
    // Error genérico
    res.status(err.status || 500).json({
        error: 'Error interno del servidor',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Algo salió mal'
    });
});

// Ruta 404
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Ruta no encontrada',
        path: req.originalUrl
    });
});

// Inicializar servidor
const startServer = async () => {
    try {
        // Inicializar base de datos
        await Database.initialize();
        console.log('Base de datos inicializada correctamente');
        
        // Iniciar servidor
        app.listen(PORT, () => {
            console.log('Servidor iniciado correctamente con autenticación');
            console.log(`URL: http://localhost:${PORT}`);
            console.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
            console.log(`Autenticación: Habilitada`);
            console.log(`Usuario admin: admin@reciclaje.com / admin123`);
            console.log(`Iniciado: ${new Date().toLocaleString('es-CO')}`);
        });
        
    } catch (error) {
        console.error('Error al iniciar el servidor:', error);
        process.exit(1);
    }
};

// Manejo de señales para cierre limpio
process.on('SIGTERM', () => {
    console.log('Cerrando servidor...');
    Database.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Cerrando servidor...');
    Database.close();
    process.exit(0);
});

// Iniciar servidor
startServer();

module.exports = app;
