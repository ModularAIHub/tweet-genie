import pool from '../config/database.js';

async function seedDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('Starting Tweet Genie database seeding...');

    // Check if seeding is needed
    const { rows: existingData } = await client.query(
      'SELECT COUNT(*) FROM migration_history'
    );

    if (parseInt(existingData[0].count) === 0) {
      console.log('No migrations found. Please run migrations first.');
      return;
    }

    console.log('Database seeding completed!');

  } catch (error) {
    console.error('Seeding error:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run seeding if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase()
    .then(() => {
      console.log('Seeding finished');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seeding failed:', error);
      process.exit(1);
    });
}

export { seedDatabase };
