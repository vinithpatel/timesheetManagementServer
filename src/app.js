const express = require("express") ;
const bodyParser = require("body-parser") ;
const cors = require("cors") ;
const path = require("path") ;

const {open} = require("sqlite") ;
const sqlite3 = require("sqlite3") ;
const { time } = require("console");


const app = express() ;

app.use(bodyParser.json()) ;
app.use(cors()) ;


let db = null ;
const dbPath = path.join(__dirname, "TimeSheetManagement.db") 

const initilizeDBAndStartServer = async () => {
    try{
        db = await open({
            filename:dbPath,
            driver:sqlite3.Database,
        });

        app.listen(8001, () => {
            console.log("Server Runnig at 8001 PORT") ;
        })
    }
    catch(error){
        console.log(error) ;
        process.exit(1) ;
    }
}


initilizeDBAndStartServer() ;

app.post("/login", async (request, response) => {
    const {employeeId, password} = request.body 

    const selectEmployeeQuery = `
        SELECT id AS employeeId, name AS employeeName, password, email, is_admin AS isAdmin
        FROM EMPLOYEE
        WHERE id LIKE '%${employeeId}%' ;
    ` 

    const employee = await db.get(selectEmployeeQuery) ;


    if(employee === undefined){
        response.status(400) ;
        response.send({text:'Invalid User'}) ;
    }else if(employee.password !== password){
        
        response.status(400) ;
        response.send({text:"Invalid Password"}) ;
    }
    else{
        response.send({
            employeeId:employee.employeeId,
            employeeName:employee.employeeName,
            email:employee.email, 
            isAdmin: employee.isAdmin === 0 ? false : true ,
        }) ;  
    }
}) ;


app.get("/projects/:employeeId", async (request, response) => {
    const {employeeId} = request.params ;

    const selectProjectsQuery = `
            SELECT PROJECT.id AS projectId, PROJECT.project_name AS projectName
            FROM EMPLOYEE_PROJECT JOIN PROJECT ON EMPLOYEE_PROJECT.project_id = PROJECT.id
            WHERE EMPLOYEE_PROJECT.employee_id = ${employeeId} ;
    `;

    try{
        const data = await db.all(selectProjectsQuery) ;
        response.send(data) ;
    }catch(error){
        console.log(error) ;
    }
});

app.get('/timesheets', async (request, response) => {

    let {timesheet_id = "",employee_id="",employee_name="",log_hours="", start_date, end_date,status=""} = request.query;   
    
    
    const selectTimeSheetsQuery = `
    SELECT TIMESHEET.id AS timeSheetId, TIMESHEET.employee_id AS employeeId , EMPLOYEE.name AS employeeName , TIMESHEET.week AS week, TIMESHEET.status AS status, TIMESHEET.start_date AS startDate,TIMESHEET.end_date AS endDate, SUM(COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(thursday, 0)+COALESCE(friday, 0)+COALESCE(wednesday, 0)+COALESCE(satuarday, 0) +COALESCE(sunday, 0)) AS logHours 
    FROM TIMESHEET JOIN TIMESHEET_PROJECT 
        ON TIMESHEET.id = TIMESHEET_PROJECT.timesheet_id JOIN EMPLOYEE ON TIMESHEET.employee_Id = EMPLOYEE.id  
    WHERE TIMESHEET.id LIKE '%${timesheet_id}%' 
            AND TIMESHEET.start_date >= '${start_date}' 
            AND TIMESHEET.end_date <= '${end_date}'
            AND EMPLOYEE.id LIKE '%${employee_id}%' 
            AND EMPLOYEE.name LIKE '%${employee_name}%'
            AND TIMESHEET.status LIKE '%${status}%'
    GROUP BY timesheet_id
    HAVING logHours LIKE '%${log_hours}%' ;
    `

    const data = await db.all(selectTimeSheetsQuery) ;
    response.send(data)

})


app.get('/timesheet/employee/:employee_id', async(request, response) => {
    const {start_date, end_date} = request.query 
    const {employee_id} = request.params
    
    const selectTimeSheetQuery = `
        SELECT id AS timeSheetId, week, status, start_date AS startDate, end_date AS endDate
        FROM TIMESHEET 
        WHERE employee_id=${employee_id} AND start_date = '${start_date}' AND end_date = '${end_date}' ;
    `

    const data = await db.get(selectTimeSheetQuery) ;
    
    response.send({data}) ;
   
})

app.post("/timesheet/create", async (request, response) => {
    const {employeeId, week, startDate, endDate} = request.body ;

    const selectTimeSheetQuery = `
        SELECT *
        FROM TIMESHEET
        WHERE employee_id = '${employeeId}' 
        AND start_date = '${startDate}' 
        AND end_date = '${endDate}' 
        AND week = '${week}' ;
    `

    const dbData = await db.get(selectTimeSheetQuery) ;
    
    if(dbData !== undefined){
        response.status(409) ;
        response.send({msg:"Invalid request data. The timesheet entry already exists."})
    }
    else{
        const insertSheetQuery = `
            INSERT INTO TIMESHEET(
                employee_id, week, start_date, end_date, status
            )
            VALUES(
                ${employeeId}, '${week}', '${startDate}', '${endDate}', 'open'
            )
        `

        const dbResponse = await db.run(insertSheetQuery)
        response.send({timeSheetId:dbResponse.lastID}) ; 
    }
       
})


// app.get('/timesheet/employee/:employee_id', async(request, response) => {
//     const {start_date, end_date} = request.query 
//     const {employee_id} = request.params
    
//     const selectTimeSheetQuery = `
//         SELECT TIMESHEET_PROJECT.id AS id, TIMESHEET.id AS timeSheetId, TIMESHEET.status AS status, TIMESHEET_PROJECT.project_id AS projectId, PROJECT.project_name AS projectName, monday, tuesday, wednesday, thursday, friday, satuarday, sunday, total, comment
//         FROM TIMESHEET JOIN TIMESHEET_PROJECT ON TIMESHEET.id = TIMESHEET_PROJECT.timesheet_id JOIN PROJECT ON PROJECT.id = TIMESHEET_PROJECT.project_id
//         WHERE TIMESHEET.employee_id=${employee_id} AND TIMESHEET.start_date = '${start_date}' AND TIMESHEET.end_date = '${end_date}' ;
//     `

//     const data = await db.all(selectTimeSheetQuery) ;
    
//     response.send(data) ;
   
// })

app.get('/timesheet/:timeSheetId', async (request, response) => {
    const {timeSheetId} = request.params ;

    const selectTimeSheetQuery = `
    SELECT TIMESHEET_PROJECT.id AS id, TIMESHEET.id AS timeSheetId, TIMESHEET.status AS status, TIMESHEET_PROJECT.project_id AS projectId, PROJECT.project_name AS projectName, 
        monday, tuesday, wednesday, thursday, friday, satuarday, 
        sunday, comment,(COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(wednesday,0)+COALESCE(thursday,0)+COALESCE(friday,0)+COALESCE(satuarday,0)+COALESCE(sunday,0)) AS total

    FROM TIMESHEET JOIN TIMESHEET_PROJECT ON TIMESHEET.id = TIMESHEET_PROJECT.timesheet_id JOIN PROJECT ON PROJECT.id = TIMESHEET_PROJECT.project_id
    WHERE TIMESHEET.id=${timeSheetId} ;

    `

    const data = await db.all(selectTimeSheetQuery)
    response.send(data) ;
})



app.put("/timesheet/submit/:timeSheetId", async (request, response) => {
    const {timeSheetId} = request.params ;

    const submitTimeSheetQuery =`
        UPDATE TIMESHEET
        SET status='submited'
        WHERE id = ${timeSheetId} ;
    `

    await db.run(submitTimeSheetQuery)

    response.send({text:"Timesheet Submited Sucessfull"}) ;
})

app.put("/timesheet/save/:timeSheetId", async (request, response) => {
    

    const {timeSheetId} = request.params ;
    const {arr} = request.body ;
    
    const deleteOldTimeSheetProjectsQuery = `
        DELETE FROM TIMESHEET_PROJECT
        WHERE timesheet_id = ${timeSheetId}
    `

    await db.run(deleteOldTimeSheetProjectsQuery) ;

    for(const row of arr){
        const insertTimeSheetProjectsQuery = `
            INSERT INTO TIMESHEET_PROJECT(
                timesheet_id, project_id, monday, tuesday, wednesday, thursday, friday, satuarday, sunday, comment
            )
            VALUES(
                ${timeSheetId}, ${row.projectId}, ${row.monday}, ${row.tuesday}, ${row.wednesday}, ${row.thursday}, ${row.friday}, ${row.satuarday}, ${row.sunday}, '${row.comment}'
            ) ;
        `
        await db.run(insertTimeSheetProjectsQuery) ; 
    }

    response.send({text:"projects data updated sucessfully"});
    
})


app.put('/timesheet/approve/:timeSheetId', async (request, response) => {
    const {timeSheetId} = request.params ;

    const approveTimeSheetQuery = `
        UPDATE TIMESHEET
        SET status = 'approved'
        WHERE id = ${timeSheetId} ;
    `

    const dbResponse = await db.run(approveTimeSheetQuery) ;

    response.send(dbResponse) ;

})

app.put('/timesheet/deny/:timeSheetId', async (request, response) => {
    const {timeSheetId} = request.params ;

    const denieTimeSheetQuery = `
        UPDATE TIMESHEET
        SET status = 'denied'
        WHERE id = ${timeSheetId} ;
    `

    const dbResponse = await db.run(denieTimeSheetQuery) ;

    response.send(dbResponse) ;

})

app.put('/timesheet/open/:timeSheetId', async (request, response) => {
    const {timeSheetId} = request.params ;

    const openTimeSheetQuery = `
        UPDATE TIMESHEET
        SET status = 'open'
        WHERE id = ${timeSheetId} ;
    `

    const dbResponse = await db.run(openTimeSheetQuery) ;

    response.send(dbResponse) ;

})