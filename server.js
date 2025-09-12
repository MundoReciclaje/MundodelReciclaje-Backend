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

// Middleware CORS
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://mundodel-reciclaje-deploy.vercel.app'] 
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true
}));

// Logging
app.use(morgan('combined'));

// IMPORTANTE: Middleware para parsear JSON DEBE IR ANTES de las rutas
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware de base de datos (después del parsing JSON)
app.use(databaseMiddleware);

// Función para crear tabla de usuarios si no existe (usando tu configuración existente)
const inicializarTablasAuth = async () => {
    try {
        // Usar tu instancia de base de datos existente
        const dbInstance = Database.getInstance();
        
        if (!dbInstance) {
            throw new Error('No se pudo obtener la instancia de la base de datos');
        }

        // Crear tabla usuarios usando tu método ejecutarSQL
        await new Promise((resolve, reject) => {
            dbInstance.run(`
                CREATE TABLE IF NOT EXISTS usuarios (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nombre VARCHAR(100) NOT NULL,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    rol VARCHAR(50) DEFAULT 'usuario',
                    activo BOOLEAN DEFAULT 1,
                    fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
                    fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP,
                    ultimo_acceso DATETIME,
                    intentos_fallidos INTEGER DEFAULT 0,
                    bloqueado_hasta DATETIME NULL
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Crear índices
        await new Promise((resolve, reject) => {
            dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email)`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        await new Promise((resolve, reject) => {
            dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_usuarios_activo ON usuarios(activo)`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // ELIMINAR usuario admin existente y crear uno nuevo para garantizar contraseña correcta
        await new Promise((resolve, reject) => {
            dbInstance.run('DELETE FROM usuarios WHERE email = ?', ['admin@reciclaje.com'], (err) => {
                if (err) reject(err);
                else {
                    console.log('Usuario administrador anterior eliminado (si existía)');
                    resolve();
                }
            });
        });

        // Crear usuario administrador por defecto con contraseña correcta
        const bcrypt = require('bcryptjs');
        const passwordHash = await bcrypt.hash('admin123', 12);
        
        const resultado = await new Promise((resolve, reject) => {
            dbInstance.run(`
                INSERT INTO usuarios (nombre, email, password_hash, rol, activo) 
                VALUES (?, ?, ?, ?, ?)
            `, ['Administrador', 'admin@reciclaje.com', passwordHash, 'administrador', 1], function(err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID });
            });
        });
        
        console.log('Usuario administrador recreado: admin@reciclaje.com / admin123');
        console.log('ID del usuario:', resultado.lastID);
        
        // Verificar que se creó correctamente
        const usuarioVerificacion = await new Promise((resolve, reject) => {
            dbInstance.get('SELECT id, email, rol, activo FROM usuarios WHERE email = ?', ['admin@reciclaje.com'], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        console.log('Verificación usuario creado:', usuarioVerificacion);

        console.log('Tablas de autenticación inicializadas correctamente');
    } catch (error) {
        console.error('Error inicializando tablas de autenticación:', error);
        throw error;
    }
};

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

// Debug de tablas (pública para desarrollo)
app.get('/api/debug/tables', async (req, res) => {
    try {
        const tables = await req.db.all(`
            SELECT name FROM sqlite_master 
            WHERE type='table' 
            ORDER BY name
        `);
        
        res.json({
            tables_found: tables.map(t => t.name),
            total_tables: tables.length,
            database_path: require('path').join(__dirname, 'database/reciclaje.db')
        });
    } catch (error) {
        res.status(500).json({ 
            error: error.message,
            database_path: require('path').join(__dirname, 'database/reciclaje.db')
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
        
        // Total compras del mes
        const totalCompras = await db.get(`
            SELECT 
                COALESCE(SUM(cg.total_pesos), 0) + COALESCE(SUM(cm.total_pesos), 0) as total
            FROM 
                (SELECT total_pesos FROM compras_generales WHERE fecha >= ?) cg
            FULL OUTER JOIN 
                (SELECT total_pesos FROM compras_materiales WHERE fecha >= ?) cm ON 1=1
        `, [fechaInicioStr, fechaInicioStr]);
        
        // Total ventas del mes
        const totalVentas = await db.get(`
            SELECT COALESCE(SUM(total_pesos), 0) as total 
            FROM ventas 
            WHERE fecha >= ?
        `, [fechaInicioStr]);
        
        // Total gastos del mes
        const totalGastos = await db.get(`
            SELECT COALESCE(SUM(valor), 0) as total 
            FROM gastos 
            WHERE fecha >= ?
        `, [fechaInicioStr]);
        
        // Materiales más vendidos
        const materialesMasVendidos = await db.all(`
            SELECT m.nombre, SUM(v.kilos) as total_kilos, SUM(v.total_pesos) as total_pesos
            FROM ventas v
            JOIN materiales m ON v.material_id = m.id
            WHERE v.fecha >= ?
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

        const usuario = await req.db.get('SELECT activo FROM usuarios WHERE id = ?', [id]);
        
        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const nuevoEstado = !usuario.activo;
        
        await req.db.run(
            'UPDATE usuarios SET activo = ?, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id = ?',
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
    
    // Error de base de datos
    if (err.code === 'SQLITE_ERROR') {
        return res.status(500).json({
            error: 'Error de base de datos',
            message: 'Problema con la operación en la base de datos'
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
        
        // Inicializar tablas de autenticación
        await inicializarTablasAuth();
        
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
