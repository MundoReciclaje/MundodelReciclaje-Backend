
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
    constructor() {
        this.db = null;
        this.dbPath = path.join(__dirname, '../../database/reciclaje.db');
    }

    static getInstance() {
        if (!Database.instance) {
            Database.instance = new Database();
        }
        return Database.instance.db;
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
        if (Database.instance && Database.instance.db) {
            Database.instance.db.close((err) => {
                if (err) {
                    console.error('❌ Error cerrando la base de datos:', err.message);
                } else {
                    console.log('✅ Base de datos cerrada correctamente');
                }
            });
        }
    }

    async init() {
        return new Promise((resolve, reject) => {
            // Asegurar que el directorio existe
            const dbDir = path.dirname(this.dbPath);
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }

            // Crear/conectar a la base de datos
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('❌ Error conectando a la base de datos:', err.message);
                    reject(err);
                } else {
                    console.log('✅ Conectado a la base de datos SQLite');
                    this.configurarDatabase();
                    this.crearTablas()
                        .then(() => resolve())
                        .catch(reject);
                }
            });
        });
    }

    configurarDatabase() {
        // Habilitar foreign keys
        this.db.run('PRAGMA foreign_keys = ON');
        
        // Configurar journal mode para mejor rendimiento
        this.db.run('PRAGMA journal_mode = WAL');
        
        // Configurar sincronización para mejor rendimiento
        this.db.run('PRAGMA synchronous = NORMAL');
        
        // Aumentar timeout
        this.db.run('PRAGMA busy_timeout = 10000');
    }

    async crearTablas() {
    const schemaPath = path.join(__dirname, '../database/schema.sql');
    
    console.log('🔍 Ruta del schema:', schemaPath);
    console.log('🔍 ¿Archivo existe?', fs.existsSync(schemaPath));
    
    if (fs.existsSync(schemaPath)) {
        try {
            const schema = fs.readFileSync(schemaPath, 'utf8');
            console.log('🔍 Tamaño del schema:', schema.length, 'caracteres');
            
            const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);
            console.log('🔍 Sentencias SQL encontradas:', statements.length);
            
            for (let i = 0; i < statements.length; i++) {
                const statement = statements[i].trim();
                if (statement) {
                    console.log(`🔍 Ejecutando sentencia ${i + 1}:`, statement.substring(0, 50) + '...');
                    try {
                        await this.ejecutarSQL(statement);
                        console.log(`✅ Sentencia ${i + 1} ejecutada correctamente`);
                    } catch (error) {
                        console.error(`❌ Error en sentencia ${i + 1}:`, error.message);
                        console.error('🔍 Sentencia completa:', statement);
                    }
                }
            }
            console.log('✅ Tablas creadas/verificadas correctamente');
        } catch (error) {
            console.error('❌ Error leyendo schema.sql:', error);
            throw error;
        }
    } else {
        console.warn('⚠️ Archivo schema.sql no encontrado, creando estructura básica...');
        await this.crearEstructuraBasica();
console.log('✅ Estructura básica creada manualmente');
    }
}

    async crearEstructuraBasica() {
        const queries = [
            `CREATE TABLE IF NOT EXISTS materiales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre VARCHAR(100) NOT NULL UNIQUE,
                categoria VARCHAR(50) NOT NULL,
                precio_ordinario DECIMAL(10,2) DEFAULT 0,
                precio_camion DECIMAL(10,2) DEFAULT 0,
                precio_noche DECIMAL(10,2) DEFAULT 0,
                activo BOOLEAN DEFAULT 1,
                fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
                fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS compras_generales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fecha DATE NOT NULL,
                total_pesos DECIMAL(12,2) NOT NULL,
                tipo_precio VARCHAR(20) NOT NULL,
                observaciones TEXT,
                fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS compras_materiales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                material_id INTEGER NOT NULL,
                fecha DATE NOT NULL,
                kilos DECIMAL(10,3) NOT NULL,
                precio_kilo DECIMAL(10,2) NOT NULL,
                total_pesos DECIMAL(12,2) NOT NULL,
                tipo_precio VARCHAR(20) NOT NULL,
                observaciones TEXT,
                fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (material_id) REFERENCES materiales(id)
            )`,
            
            `CREATE TABLE IF NOT EXISTS ventas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                material_id INTEGER NOT NULL,
                fecha DATE NOT NULL,
                kilos DECIMAL(10,3) NOT NULL,
                precio_kilo DECIMAL(10,2) NOT NULL,
                total_pesos DECIMAL(12,2) NOT NULL,
                cliente VARCHAR(100),
                observaciones TEXT,
                fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (material_id) REFERENCES materiales(id)
            )`,
            
            `CREATE TABLE IF NOT EXISTS categorias_gastos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre VARCHAR(50) NOT NULL UNIQUE,
                descripcion TEXT,
                activo BOOLEAN DEFAULT 1
            )`,
            
            `CREATE TABLE IF NOT EXISTS gastos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                categoria_id INTEGER NOT NULL,
                fecha DATE NOT NULL,
                concepto VARCHAR(200) NOT NULL,
                valor DECIMAL(12,2) NOT NULL,
                observaciones TEXT,
                fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (categoria_id) REFERENCES categorias_gastos(id)
            )`
        ];

        for (const query of queries) {
            await this.ejecutarSQL(query);
        }

        // Insertar datos iniciales si no existen
        await this.insertarDatosIniciales();
    }

    async insertarDatosIniciales() {
        // Verificar si ya hay categorías de gastos
        const categoriasExistentes = await this.ejecutarSQL('SELECT COUNT(*) as count FROM categorias_gastos');
        
        if (categoriasExistentes[0].count === 0) {
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
                    'INSERT INTO categorias_gastos (nombre, descripcion) VALUES (?, ?)',
                    [nombre, descripcion]
                );
            }
            console.log('✅ Categorías de gastos iniciales creadas');
        }

        // Verificar si ya hay materiales
        const materialesExistentes = await this.ejecutarSQL('SELECT COUNT(*) as count FROM materiales');
        
        if (materialesExistentes[0].count === 0) {
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
                    'INSERT INTO materiales (nombre, categoria, precio_ordinario, precio_camion, precio_noche) VALUES (?, ?, ?, ?, ?)',
                    [nombre, categoria, precio_ordinario, precio_camion, precio_noche]
                );
            }
            console.log('✅ Materiales iniciales creados (61 materiales)');
        }
    }

    ejecutarSQL(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (sql.trim().toUpperCase().startsWith('SELECT')) {
                this.db.all(sql, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            } else {
                this.db.run(sql, params, function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, changes: this.changes });
                });
            }
        });
    }

    // Métodos helper para operaciones comunes
    async obtenerTodos(tabla, condiciones = '', params = []) {
        const sql = `SELECT * FROM ${tabla} ${condiciones}`;
        return this.ejecutarSQL(sql, params);
    }

    async obtenerPorId(tabla, id) {
        const sql = `SELECT * FROM ${tabla} WHERE id = ?`;
        const rows = await this.ejecutarSQL(sql, [id]);
        return rows[0] || null;
    }

    async insertar(tabla, datos) {
        const columnas = Object.keys(datos);
        const placeholders = columnas.map(() => '?').join(', ');
        const valores = Object.values(datos);
        
        const sql = `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${placeholders})`;
        return this.ejecutarSQL(sql, valores);
    }

    async actualizar(tabla, id, datos) {
        const columnas = Object.keys(datos);
        const setClause = columnas.map(col => `${col} = ?`).join(', ');
        const valores = [...Object.values(datos), id];
        
        const sql = `UPDATE ${tabla} SET ${setClause} WHERE id = ?`;
        return this.ejecutarSQL(sql, valores);
    }

    async eliminar(tabla, id) {
        const sql = `DELETE FROM ${tabla} WHERE id = ?`;
        return this.ejecutarSQL(sql, [id]);
    }
}

module.exports = Database;