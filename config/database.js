
const { Pool } = require('pg');

class Database {
    constructor() {
        this.pool = null;
    }

    static getInstance() {
        if (!Database.instance) {
            Database.instance = new Database();
        }
        return Database.instance;
    }

    static async initialize() {
        try {
            if (!Database.instance) {
                Database.instance = new Database();
            }
            await Database.instance.init();
            return Database.instance;
        } catch (error) {
            console.error('❌ Error inicializando base de datos:', error);
            throw error;
        }
    }

    static close() {
        if (Database.instance && Database.instance.pool) {
            Database.instance.pool.end(() => {
                console.log('✅ Pool de conexiones cerrado correctamente');
            });
        }
    }

    async init() {
        try {
            this.pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 2000,
            });

            // Probar conexión
            const client = await this.pool.connect();
            await client.query('SELECT NOW()');
            client.release();
            
            console.log('✅ Conectado a PostgreSQL en Supabase');
            
            await this.crearTablas();
        } catch (error) {
            console.error('❌ Error conectando a PostgreSQL:', error);
            throw error;
        }
    }

    async crearTablas() {
        try {
            await this.crearEstructuraCompleta();
            await this.insertarDatosIniciales();
            console.log('✅ Tablas y datos iniciales creados/verificados correctamente');
        } catch (error) {
            console.error('❌ Error creando estructura de base de datos:', error);
            throw error;
        }
    }

    async crearEstructuraCompleta() {
        const queries = [
            // Tabla materiales
            `CREATE TABLE IF NOT EXISTS materiales (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(100) NOT NULL UNIQUE,
                categoria VARCHAR(50) NOT NULL,
                precio_ordinario DECIMAL(10,2) DEFAULT 0,
                precio_camion DECIMAL(10,2) DEFAULT 0,
                precio_noche DECIMAL(10,2) DEFAULT 0,
                activo BOOLEAN DEFAULT true,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // Tabla compras generales
            `CREATE TABLE IF NOT EXISTS compras_generales (
                id SERIAL PRIMARY KEY,
                fecha DATE NOT NULL,
                total_pesos DECIMAL(12,2) NOT NULL,
                tipo_precio VARCHAR(20) NOT NULL,
                observaciones TEXT,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // Tabla compras materiales
            `CREATE TABLE IF NOT EXISTS compras_materiales (
                id SERIAL PRIMARY KEY,
                material_id INTEGER NOT NULL,
                fecha DATE NOT NULL,
                kilos DECIMAL(10,3) NOT NULL,
                precio_kilo DECIMAL(10,2) NOT NULL,
                total_pesos DECIMAL(12,2) NOT NULL,
                tipo_precio VARCHAR(20) NOT NULL,
                observaciones TEXT,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (material_id) REFERENCES materiales(id)
            )`,
            
            // Tabla ventas
            `CREATE TABLE IF NOT EXISTS ventas (
                id SERIAL PRIMARY KEY,
                material_id INTEGER NOT NULL,
                fecha DATE NOT NULL,
                kilos DECIMAL(10,3) NOT NULL,
                precio_kilo DECIMAL(10,2) NOT NULL,
                total_pesos DECIMAL(12,2) NOT NULL,
                cliente VARCHAR(100),
                observaciones TEXT,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (material_id) REFERENCES materiales(id)
            )`,
            
            // Tabla categorías de gastos
            `CREATE TABLE IF NOT EXISTS categorias_gastos (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(50) NOT NULL UNIQUE,
                descripcion TEXT,
                activo BOOLEAN DEFAULT true
            )`,
            
            // Tabla gastos
            `CREATE TABLE IF NOT EXISTS gastos (
                id SERIAL PRIMARY KEY,
                categoria_id INTEGER NOT NULL,
                fecha DATE NOT NULL,
                concepto VARCHAR(200) NOT NULL,
                valor DECIMAL(12,2) NOT NULL,
                observaciones TEXT,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (categoria_id) REFERENCES categorias_gastos(id)
            )`,

            // Tabla usuarios (para autenticación)
            `CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(100) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                rol VARCHAR(50) DEFAULT 'usuario',
                activo BOOLEAN DEFAULT true,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ultimo_acceso TIMESTAMP,
                intentos_fallidos INTEGER DEFAULT 0,
                bloqueado_hasta TIMESTAMP NULL
            )`
        ];

        // Crear índices
        const indices = [
            'CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email)',
            'CREATE INDEX IF NOT EXISTS idx_usuarios_activo ON usuarios(activo)',
            'CREATE INDEX IF NOT EXISTS idx_materiales_categoria ON materiales(categoria)',
            'CREATE INDEX IF NOT EXISTS idx_compras_fecha ON compras_generales(fecha)',
            'CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha)',
            'CREATE INDEX IF NOT EXISTS idx_gastos_fecha ON gastos(fecha)'
        ];

        // Ejecutar creación de tablas
        for (const query of queries) {
            await this.ejecutarSQL(query);
        }

        // Ejecutar creación de índices
        for (const indice of indices) {
            await this.ejecutarSQL(indice);
        }
    }

    async insertarDatosIniciales() {
        // Verificar si ya hay categorías de gastos
        const categoriasExistentes = await this.ejecutarSQL('SELECT COUNT(*) as count FROM categorias_gastos');
        
        if (parseInt(categoriasExistentes.rows[0].count) === 0) {
            const categorias = [
                ['Sueldos', 'Pagos de salarios y prestaciones'],
                ['Gas Camión', 'Combustible para vehículos'],
                ['Alimentación', 'Gastos de comida y bebidas'],
                ['Otros', 'Gastos varios y misceláneos'],
                ['Mantenimiento', 'Reparaciones y mantenimiento'],
                ['Servicios', 'Agua, luz, internet, etc.']
            ];

            for (const [nombre, descripcion] of categorias) {
                await this.ejecutarSQL(
                    'INSERT INTO categorias_gastos (nombre, descripcion) VALUES ($1, $2)',
                    [nombre, descripcion]
                );
            }
            console.log('✅ Categorías de gastos iniciales creadas');
        }

        // Verificar si ya hay materiales
        const materialesExistentes = await this.ejecutarSQL('SELECT COUNT(*) as count FROM materiales');
        
        if (parseInt(materialesExistentes.rows[0].count) === 0) {
            const materiales = [
                // METALES
                ['Chatarra', 'Metales', 0, 0, 0],
                ['Cobre #1', 'Metales-Cobre', 0, 0, 0],
                ['Cobre #2', 'Metales-Cobre', 0, 0, 0],
                ['Radiador de Cobre', 'Metales-Cobre', 0, 0, 0],
                ['Bronce Limpio', 'Metales-Bronce', 0, 0, 0],
                ['Bronce Pintado', 'Metales-Bronce', 0, 0, 0],
                ['Acero Grueso Limpio', 'Metales-Acero', 0, 0, 0],
                ['Grueso Sucio', 'Metales-Acero', 0, 0, 0],
                ['Olla Limpia', 'Metales-Ollas', 0, 0, 0],
                ['Olla Sucia', 'Metales-Ollas', 0, 0, 0],
                ['Perfil Limpio', 'Metales-Perfiles', 0, 0, 0],
                ['Perfil Sucio', 'Metales-Perfiles', 0, 0, 0],
                ['Guaya', 'Metales-Varios', 0, 0, 0],
                ['Antimonio', 'Metales-Varios', 0, 0, 0],
                ['Radiador Aluminio', 'Metales-Aluminio', 0, 0, 0],
                ['Plancha', 'Metales-Aluminio', 0, 0, 0],
                ['Rin Carro', 'Metales-Aluminio', 0, 0, 0],
                ['Rin Cicla', 'Metales-Aluminio', 0, 0, 0],
                ['Aerosol Limpio', 'Metales-Aluminio', 0, 0, 0],

                // PAPELES Y CARTONES
                ['Cartón', 'Papeles', 0, 0, 0],
                ['Archivo', 'Papeles', 0, 0, 0],

                // PLÁSTICOS
                ['PET', 'Plásticos', 0, 0, 0],
                ['Ambar', 'Plásticos', 0, 0, 0],
                ['Tapas', 'Plásticos', 0, 0, 0],
                ['Canecas', 'Plásticos', 0, 0, 0],
                ['Vasija Verde', 'Plásticos', 0, 0, 0],
                ['Soplado', 'Plásticos', 0, 0, 0],
                ['Aceite', 'Plásticos', 0, 0, 0],
                ['PVC Tubo', 'Plásticos', 0, 0, 0],
                ['PVC Techo', 'Plásticos', 0, 0, 0],
                ['PVC Blando', 'Plásticos', 0, 0, 0],
                ['Plástico', 'Plásticos', 0, 0, 0],
                ['Acrílico', 'Plásticos', 0, 0, 0],

                // VIDRIOS
                ['Vidrio', 'Vidrios', 0, 0, 0],
                ['Clausen', 'Vidrios', 0, 0, 0],

                // BATERÍAS
                ['Baterias Taxi 22', 'Baterías', 0, 0, 0],
                ['Baterias 24', 'Baterías', 0, 0, 0],
                ['Baterias 27', 'Baterías', 0, 0, 0],
                ['Bateria 30H', 'Baterías', 0, 0, 0],
                ['Baterias 4D', 'Baterías', 0, 0, 0],
                ['Baterias 8D', 'Baterías', 0, 0, 0],
                ['Moto Plomo', 'Baterías', 0, 0, 0],
                ['Balancines', 'Baterías', 0, 0, 0],
                ['Baterias Polimero (no inflada)', 'Baterías-Electrónicos', 0, 0, 0],
                ['Baterias Celular (no inflada)', 'Baterías-Electrónicos', 0, 0, 0],
                ['Bateria Portatil (no inflada)', 'Baterías-Electrónicos', 0, 0, 0],

                // ELECTRÓNICOS
                ['CD', 'Electrónicos', 0, 0, 0],
                ['Disco Duro', 'Electrónicos', 0, 0, 0],
                ['Tarjeta Bajo Marrón', 'Electrónicos-Tarjetas', 0, 0, 0],
                ['Tarjeta Bajo Verde', 'Electrónicos-Tarjetas', 0, 0, 0],
                ['Tarjeta Decodificador', 'Electrónicos-Tarjetas', 0, 0, 0],
                ['Tarjeta Modem', 'Electrónicos-Tarjetas', 0, 0, 0],
                ['Tarjeta Tipo #1', 'Electrónicos-Tarjetas', 0, 0, 0],
                ['Tarjeta Pentium', 'Electrónicos-Tarjetas', 0, 0, 0],
                ['Tarjeta Tablet', 'Electrónicos-Tarjetas', 0, 0, 0],
                ['Tarjeta Celular', 'Electrónicos-Tarjetas', 0, 0, 0],
                ['Celular Smart', 'Electrónicos-Dispositivos', 0, 0, 0],
                ['Celular Teclas', 'Electrónicos-Dispositivos', 0, 0, 0],
                ['Tablet', 'Electrónicos-Dispositivos', 0, 0, 0],
                ['RAM Dorada', 'Electrónicos-Componentes', 0, 0, 0],
                ['Procesador UND', 'Electrónicos-Componentes', 0, 0, 0]
            ];

            for (const [nombre, categoria, precio_ordinario, precio_camion, precio_noche] of materiales) {
                await this.ejecutarSQL(
                    'INSERT INTO materiales (nombre, categoria, precio_ordinario, precio_camion, precio_noche) VALUES ($1, $2, $3, $4, $5)',
                    [nombre, categoria, precio_ordinario, precio_camion, precio_noche]
                );
            }
            console.log('✅ Materiales iniciales creados (61 materiales)');
        }

        // Crear usuario administrador por defecto
        const usuariosExistentes = await this.ejecutarSQL('SELECT COUNT(*) as count FROM usuarios WHERE email = $1', ['admin@reciclaje.com']);
        
        if (parseInt(usuariosExistentes.rows[0].count) === 0) {
            const bcrypt = require('bcryptjs');
            const passwordHash = await bcrypt.hash('admin123', 12);
            
            await this.ejecutarSQL(`
                INSERT INTO usuarios (nombre, email, password_hash, rol, activo) 
                VALUES ($1, $2, $3, $4, $5)
            `, ['Administrador', 'admin@reciclaje.com', passwordHash, 'administrador', true]);
            
            console.log('✅ Usuario administrador creado: admin@reciclaje.com / admin123');
        }
    }

    async ejecutarSQL(sql, params = []) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(sql, params);
            return result;
        } finally {
            client.release();
        }
    }

    // Métodos helper para operaciones comunes (adaptados para PostgreSQL)
    async obtenerTodos(tabla, condiciones = '', params = []) {
        const sql = `SELECT * FROM ${tabla} ${condiciones}`;
        const result = await this.ejecutarSQL(sql, params);
        return result.rows;
    }

    async obtenerPorId(tabla, id) {
        const sql = `SELECT * FROM ${tabla} WHERE id = $1`;
        const result = await this.ejecutarSQL(sql, [id]);
        return result.rows[0] || null;
    }

    async insertar(tabla, datos) {
        const columnas = Object.keys(datos);
        const placeholders = columnas.map((_, index) => `$${index + 1}`).join(', ');
        const valores = Object.values(datos);
        
        const sql = `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${placeholders}) RETURNING *`;
        const result = await this.ejecutarSQL(sql, valores);
        return result.rows[0];
    }

    async actualizar(tabla, id, datos) {
        const columnas = Object.keys(datos);
        const setClause = columnas.map((col, index) => `${col} = $${index + 1}`).join(', ');
        const valores = [...Object.values(datos), id];
        
        const sql = `UPDATE ${tabla} SET ${setClause} WHERE id = $${valores.length} RETURNING *`;
        const result = await this.ejecutarSQL(sql, valores);
        return result.rows[0];
    }

    async eliminar(tabla, id) {
        const sql = `DELETE FROM ${tabla} WHERE id = $1 RETURNING *`;
        const result = await this.ejecutarSQL(sql, [id]);
        return result.rows[0];
    }

    // Método para obtener estadísticas (compatible con PostgreSQL)
    async obtenerEstadisticas(fechaInicio) {
        const queries = {
            totalCompras: `
                SELECT COALESCE(SUM(total_pesos), 0) as total 
                FROM (
                    SELECT total_pesos FROM compras_generales WHERE fecha >= $1
                    UNION ALL
                    SELECT total_pesos FROM compras_materiales WHERE fecha >= $1
                ) compras
            `,
            totalVentas: `
                SELECT COALESCE(SUM(total_pesos), 0) as total 
                FROM ventas 
                WHERE fecha >= $1
            `,
            totalGastos: `
                SELECT COALESCE(SUM(valor), 0) as total 
                FROM gastos 
                WHERE fecha >= $1
            `
        };

        const [compras, ventas, gastos] = await Promise.all([
            this.ejecutarSQL(queries.totalCompras, [fechaInicio]),
            this.ejecutarSQL(queries.totalVentas, [fechaInicio]),
            this.ejecutarSQL(queries.totalGastos, [fechaInicio])
        ]);

        return {
            totalCompras: parseFloat(compras.rows[0].total || 0),
            totalVentas: parseFloat(ventas.rows[0].total || 0),
            totalGastos: parseFloat(gastos.rows[0].total || 0)
        };
    }
}

module.exports = Database;
