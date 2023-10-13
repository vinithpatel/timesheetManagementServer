const express = require("express") ;
const bodyParser = require("body-parser") ;
const cors = require("cors") ;
const path = require("path") ;

const {open} = require("sqlite") ;
const sqlite3 = require("sqlite3") ;

const {startOfWeek, endOfWeek, format, getDay, nextMonday, previousSunday, getWeek} = require("date-fns") ;
const bcrypt = require("bcrypt") ;
const jwt = require("jsonwebtoken") ;


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


const authenticateToken = (request, response, next) => {
    let jwtToken ;

    const authHeader = request.headers["authorization"];
    
    if(authHeader !== undefined){
        jwtToken = authHeader.split(' ')[1] ;
    }

    if(jwtToken === undefined){
        response.status(400) ;
        response.send("Invalid JWT Token") ;
    }
    else{
        jwt.verify(jwtToken, 'TIMESHEET_MANAGEMENT', async(error, payload) => {
            if(error){
                response.status(401) ;
                response.send("Invalid JWT TOKEN") ;
            }else{
                request.payload = payload ;
                next() ;
            }
        })
    }
}

const isAdminstartor = async (request, response, next) => {
    const {payload} = request ;
    const {employeeId} = payload ;


    const selectEmployeeQuery = `
        SELECT EMPLOYEE.id AS employeeId, EMPLOYEE.name AS employeeName, password, official_mail AS officialMail, DEPARTMENT.is_admin AS isAdmin
        FROM EMPLOYEE JOIN DEPARTMENT ON DEPARTMENT.id = EMPLOYEE.department_id 
        WHERE EMPLOYEE.id LIKE '%${employeeId}%' ;
    `

    try{
        const employeeObj = await db.get(selectEmployeeQuery) ;
        if(employeeObj !== undefined && employeeObj.isAdmin === 1){
            next() ;
        }else{
            response.status(403) ;
            response.send({message:"Access Denied"}) ;
        }
    }
    catch(error){
        console.log(error)
        console.log("error")
    }

}


app.post("/login", async (request, response) => {
    const {employeeId, password} = request.body 

    const selectEmployeeQuery = `
        SELECT EMPLOYEE.id AS employeeId, EMPLOYEE.name AS employeeName, password, official_mail AS officialMail, is_admin AS isAdmin
        FROM EMPLOYEE
        WHERE id LIKE '%${employeeId}%' ;
    ` 

    const employee = await db.get(selectEmployeeQuery) ;

    if(employee === undefined){
        response.status(400) ;
        response.send({text:'Invalid User'}) ;
    }else if(! await bcrypt.compare(password,employee.password)){ 
        
        response.status(400) ;
        response.send({text:"Invalid Password"}) ;
    }
    else{

        const payload = {
            employeeId:employee.employeeId ,
            employeeName:employee.employeeName,
            officialMail:employee.officialMail
        }

        const jwtToken = jwt.sign(payload, 'TIMESHEET_MANAGEMENT') ;
        response.send({jwtToken}) ;

    }
}) ;

app.get('/employee/profile',authenticateToken,async (request, response) => {
    const {payload} = request
    const {employeeId} = payload ;

    const getEmployeeDetailsQuery = `
            SELECT EMPLOYEE.id AS employeeId, EMPLOYEE.name AS employeeName,EMPLOYEE.personal_mail AS personalMail, EMPLOYEE.official_mail AS officialMail, 
            POSITION.position_name AS positionName, DEPARTMENT.name AS departmentName, DEPARTMENT.is_admin AS isAdmin,
            TEMP_EMPLOYEE.name AS reportingManagerName, TEMP_EMPLOYEE.official_mail AS reportingManagerMail 
            FROM EMPLOYEE JOIN POSITION ON EMPLOYEE.position_id = POSITION.id JOIN DEPARTMENT ON DEPARTMENT.id = EMPLOYEE.department_id LEFT JOIN EMPLOYEE AS TEMP_EMPLOYEE ON EMPLOYEE.reporting_manager_id = TEMP_EMPLOYEE.id
            WHERE EMPLOYEE.id LIKE '%${employeeId}%' ;
        `

        const dbData = await db.get(getEmployeeDetailsQuery) ;

        response.send(dbData !== undefined ? dbData : {}) ;

})


app.get("/projects/employee/:employeeId", async (request, response) => {
    const {employeeId} = request.params ;

    const selectProjectsQuery = `
            SELECT CURRENT_PROJECT.id AS projectId, CURRENT_PROJECT.project_name AS projectName, 
            EMPLOYEE_PROJECT.start_date AS startDate, EMPLOYEE_PROJECT.end_date AS endDate, EMPLOYEE_PROJECT.role_id AS roleId, EMPLOYEE_PROJECT.rate AS rate, 
            EMPLOYEE_PROJECT.currency AS currency, CURRENT_PROJECT.type AS projectType
            FROM EMPLOYEE_PROJECT JOIN CURRENT_PROJECT ON EMPLOYEE_PROJECT.project_id = CURRENT_PROJECT.id
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
        SELECT TIMESHEET.id AS timeSheetId, week, status, start_date AS startDate, end_date AS endDate, EMPLOYEE.name AS employeeName, EMPLOYEE.official_mail AS officialMail
        FROM TIMESHEET JOIN EMPLOYEE ON EMPLOYEE.id = TIMESHEET.employee_id
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

app.post('/timesheet/recreate/:timeSheetId', async (request, response) => {
    const {timeSheetId} = request.params ;

    const deleteProjectQuery = `
        DELETE FROM TIMESHEET_PROJECT
        WHERE timesheet_id = ${timeSheetId} ;
    `

    const openTimeSheetQuery = `
        UPDATE TIMESHEET
        SET status = 'open'
        WHERE id = ${timeSheetId} ;
    `

    try{
        await db.run(deleteProjectQuery) ;
        await db.run(openTimeSheetQuery) ;
        response.send({message: 'timesheet re-opened succesfull'})

    }
    catch(error){
        console.log(error) ;
        response.status(404) ;
        response.send({message:"unknow error"}) ;
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
        SELECT TIMESHEET.id AS timeSheetId, TIMESHEET.employee_id AS employeeId, EMPLOYEE.name AS employeeName,EMPLOYEE.official_mail AS officialMail, week, status, start_date AS startDate, end_date AS endDate, EMPLOYEE.reporting_manager_id AS reportingManagerId
        FROM TIMESHEET JOIN EMPLOYEE ON EMPLOYEE.id = TIMESHEET.employee_id
        WHERE TIMESHEET.id = '${timeSheetId}';
    `

    const data = await db.get(selectTimeSheetQuery) ;

    if(data === undefined){
        response.status(404) ;
        response.send({message:'timesheet not exist'})
    }else{
        response.send(data) ;
    }

    
    
})

app.get('/timesheet/projects/:timeSheetId', async (request, response) => {
    const {timeSheetId} = request.params ;

    const selectTimeSheetQuery = `
    SELECT TIMESHEET_PROJECT.id AS id, TIMESHEET.id AS timeSheetId, TIMESHEET.status AS status, TIMESHEET_PROJECT.project_id AS projectId, PROJECT.project_name AS projectName, 
        monday, tuesday, wednesday, thursday, friday, satuarday, 
        sunday,(COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(wednesday,0)+COALESCE(thursday,0)+COALESCE(friday,0)+COALESCE(satuarday,0)+COALESCE(sunday,0)) AS total,
        monday_comment AS mondayComment, tuesday_comment AS tuesdayComment, wednesday_comment AS wednesdayComment, 
        thursday_comment AS thursdayComment, friday_comment AS fridayComment, 
        satuarday_comment AS satuardayComment, sunday_comment AS sundayComment

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
                timesheet_id, project_id, monday, tuesday, wednesday, thursday, friday, satuarday, sunday,
                monday_comment, tuesday_comment, wednesday_comment, thursday_comment, friday_comment, satuarday_comment, sunday_comment, rate, currency, role_id
            )
            VALUES(
                ${timeSheetId}, ${row.projectId}, ${row.monday}, ${row.tuesday}, ${row.wednesday}, ${row.thursday}, ${row.friday}, ${row.satuarday}, ${row.sunday},
                '${row.mondayComment}','${row.tuesdayComment}', '${row.wednesdayComment}', '${row.thursdayComment}', '${row.fridayComment}', '${row.satuardayComment}', '${row.sundayComment}',
                (
                    SELECT rate
                    FROM EMPLOYEE_PROJECT JOIN TIMESHEET ON TIMESHEET.employee_id = EMPLOYEE_PROJECT.employee_id
                    WHERE TIMESHEET.id = ${timeSheetId} AND EMPLOYEE_PROJECT.project_id = ${row.projectId} 
                ),
                (
                    SELECT currency
                    FROM EMPLOYEE_PROJECT JOIN TIMESHEET ON TIMESHEET.employee_id = EMPLOYEE_PROJECT.employee_id
                    WHERE TIMESHEET.id = ${timeSheetId} AND EMPLOYEE_PROJECT.project_id = ${row.projectId} 
                ),
                (
                    SELECT role_id
                    FROM EMPLOYEE_PROJECT JOIN TIMESHEET ON TIMESHEET.employee_id = EMPLOYEE_PROJECT.employee_id
                    WHERE TIMESHEET.id = ${timeSheetId} AND EMPLOYEE_PROJECT.project_id = ${row.projectId}
                )
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


app.get('/timesheet/export/:timeSheetId', async(request, response) => {
        const {timeSheetId} = request.params 
        
        const selectTimeSheetQuery = `
        SELECT TIMESHEET_PROJECT.project_id AS projectId, PROJECT.project_name AS projectName,
        (COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(wednesday,0)+COALESCE(thursday,0)+COALESCE(friday,0)+COALESCE(satuarday,0)+COALESCE(sunday,0)) AS total, 
        ((COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(wednesday,0)+COALESCE(thursday,0)+COALESCE(friday,0)+COALESCE(satuarday,0)+COALESCE(sunday,0)) * COALESCE(TIMESHEET_PROJECT.rate, 0)/8) AS cost, TIMESHEET_PROJECT.rate, TIMESHEET_PROJECT.currency

        FROM TIMESHEET JOIN EMPLOYEE ON EMPLOYEE.id = TIMESHEET.employee_id JOIN TIMESHEET_PROJECT ON TIMESHEET_PROJECT.timesheet_id = TIMESHEET.id JOIN PROJECT ON project.id = TIMESHEET_PROJECT.project_id
        WHERE TIMESHEET.id=${timeSheetId} ;
        `

        const data = await db.all(selectTimeSheetQuery)
        
        response.send(data) ;
});

app.get('/timesheet/employee/:employeeId/monthly_export/:monthValue',authenticateToken,isAdminstartor, async (request, response) => {

    const {employeeId, monthValue} = request.params;

    const [year, month] = monthValue.split("-") ;

    const date = new Date(year, month-1, 1)
    
    const firstWeekNumber = getWeek(date, {weekStartsOn:1, firstWeekContainsDate:2})
    const firstWeekNumberFormat = `${year}-W${firstWeekNumber}`

    const monthSecondWeekDate = nextMonday(date) ;
    const secondWeekFirstDayFormat = format(monthSecondWeekDate, 'yyyy-MM-dd') ;


    const columnNames = ['COALESCE(monday,0)', 'COALESCE(tuesday,0)','COALESCE(wednesday,0)' , 'COALESCE(thursday,0)', 'COALESCE(friday,0)', 'COALESCE(satuarday, 0)', 'COALESCE(sunday, 0)'] ;

    let dayOfWeek = getDay(date) ;

    if(dayOfWeek === 0){
        dayOfWeek = 6 ;
    }else{
        dayOfWeek -= 1
    }
    const firstWeekColumnNames = columnNames.slice(dayOfWeek).join('+');


    date.setMonth(date.getMonth() + 1) ;
    date.setDate(0) ;

    const monthEndWeekNumber = getWeek(date, {weekStartsOn:1, firstWeekContainsDate:2})
    const endWeekNumberFormat = `${year}-W${monthEndWeekNumber}`

    const monthEndPreviousWeekDate = previousSunday(date) ;
    const monthEndtPreviousWeekFormat = format(monthEndPreviousWeekDate, 'yyyy-MM-dd') ;

    dayOfWeek = getDay(date) ;

    if(dayOfWeek === 0){
        dayOfWeek = 7 ;
    }

    const lastWeekColumnNames = columnNames.slice(0, dayOfWeek).join('+') ;

    // console.log(firstWeekNumberFormat)
    // console.log(secondWeekFirstDayFormat)
    // console.log(firstWeekColumnNames)

    // console.log(endWeekNumberFormat)
    // console.log(monthEndtPreviousWeekFormat)
    // console.log(lastWeekColumnNames)

    const firstWeekSelectQuery = `
        SELECT TIMESHEET_PROJECT.project_id AS projectId, PROJECT.project_name AS projectName,PROJECT.type AS projectType,CUSTOMER.name AS customerName,POSITION.position_name AS positionName,PROJECT.cost_type AS costType,
        SUM(${firstWeekColumnNames}) AS total,
        SUM((${firstWeekColumnNames}) * COALESCE(TIMESHEET_PROJECT.rate,0)/8) AS cost,TIMESHEET_PROJECT.rate, TIMESHEET_PROJECT.currency
        FROM TIMESHEET JOIN EMPLOYEE ON EMPLOYEE.id = TIMESHEET.employee_id JOIN TIMESHEET_PROJECT ON TIMESHEET_PROJECT.timesheet_id = TIMESHEET.id JOIN PROJECT ON PROJECT.id = TIMESHEET_PROJECT.project_id LEFT JOIN CUSTOMER ON CUSTOMER.id = PROJECT.customer_id 
        LEFT JOIN POSITION ON TIMESHEET_PROJECT.role_id = POSITION.id
        WHERE TIMESHEET.week LIKE '%${firstWeekNumberFormat}%' AND TIMESHEET.employee_id LIKE '%${employeeId}%'
        GROUP BY projectId, rate, positionName
    `

    const lastWeekSelectQuery = `
        SELECT TIMESHEET_PROJECT.project_id AS projectId, PROJECT.project_name AS projectName,PROJECT.type AS projectType, CUSTOMER.name AS customerName,POSITION.position_name AS positionName,PROJECT.cost_type AS costType,
        SUM(${lastWeekColumnNames}) AS total,
        SUM((${lastWeekColumnNames}) * COALESCE(TIMESHEET_PROJECT.rate,0)/8) AS cost,TIMESHEET_PROJECT.rate, TIMESHEET_PROJECT.currency
        FROM TIMESHEET JOIN EMPLOYEE ON EMPLOYEE.id = TIMESHEET.employee_id JOIN TIMESHEET_PROJECT ON TIMESHEET_PROJECT.timesheet_id = TIMESHEET.id JOIN PROJECT ON PROJECT.id = TIMESHEET_PROJECT.project_id LEFT JOIN CUSTOMER ON CUSTOMER.id = PROJECT.customer_id
        LEFT JOIN POSITION ON TIMESHEET_PROJECT.role_id = POSITION.id
        WHERE TIMESHEET.week LIKE '%${endWeekNumberFormat}%' AND TIMESHEET.employee_id LIKE '%${employeeId}%'
        GROUP BY projectId, rate, positionName
    `

    const middleWeeksSelectQuery = `
        SELECT TIMESHEET_PROJECT.project_id AS projectId, PROJECT.project_name AS projectName,PROJECT.type AS projectType,CUSTOMER.name AS customerName,POSITION.position_name AS positionName,PROJECT.cost_type AS costType,
        SUM(COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(wednesday,0)+COALESCE(thursday,0)+COALESCE(friday,0)+COALESCE(satuarday,0)+COALESCE(sunday,0)) AS total, 
        SUM((COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(wednesday,0)+COALESCE(thursday,0)+COALESCE(friday,0)+COALESCE(satuarday,0)+COALESCE(sunday,0)) * COALESCE(TIMESHEET_PROJECT.rate,0)/8) AS cost,TIMESHEET_PROJECT.rate, TIMESHEET_PROJECT.currency

        FROM TIMESHEET JOIN EMPLOYEE ON EMPLOYEE.id = TIMESHEET.employee_id JOIN TIMESHEET_PROJECT ON TIMESHEET_PROJECT.timesheet_id = TIMESHEET.id JOIN PROJECT ON project.id = TIMESHEET_PROJECT.project_id LEFT JOIN CUSTOMER ON CUSTOMER.id = PROJECT.customer_id
        LEFT JOIN POSITION ON TIMESHEET_PROJECT.role_id = POSITION.id
        WHERE TIMESHEET.id IN (SELECT TIMESHEET.id AS id 
            FROM TIMESHEET
            WHERE TIMESHEET.employee_id LIKE '%${employeeId}%' AND TIMESHEET.start_date >= '${secondWeekFirstDayFormat}' AND TIMESHEET.end_date <= '${monthEndtPreviousWeekFormat}')
        GROUP BY projectId, rate, positionName
    `

    const selectMonthQuery = `
            WITH FirstWeek AS (
                ${firstWeekSelectQuery}
            ),
            MiddleWeek AS (
                ${middleWeeksSelectQuery}
            ),
            LastWeek AS (
                ${lastWeekSelectQuery}
            )
            SELECT projectId, projectName, SUM(total) AS total, SUM(cost) AS cost, rate, currency, projectType, customerName, positionName,costType
            FROM (
                SELECT * FROM FirstWeek
                UNION ALL
                SELECT * FROM MiddleWeek
                UNION ALL
                SELECT * FROM LastWeek
            ) AS CombineQuery
            GROUP BY projectId, rate, positionName;
    `

    const data = await db.all(selectMonthQuery)
    response.send(data) ;

})

app.get('/timesheet/employee/:employeeId/custom_export/',authenticateToken,isAdminstartor, async (request, response) => {

    const {employeeId} = request.params;
    const {startDate, endDate} = request.query ;
    

    //const [year, month] = monthValue.split("-") ;

    let date = new Date(startDate) ;
    const year = date.getFullYear() ;
    
    const firstWeekNumber = getWeek(date, {weekStartsOn:1, firstWeekContainsDate:2})
    const firstWeekNumberFormat = `${year}-W${firstWeekNumber}`

    const monthSecondWeekDate = nextMonday(date) ;
    const secondWeekFirstDayFormat = format(monthSecondWeekDate, 'yyyy-MM-dd') ;


    const columnNames = ['COALESCE(monday,0)', 'COALESCE(tuesday,0)','COALESCE(wednesday,0)' , 'COALESCE(thursday,0)', 'COALESCE(friday,0)', 'COALESCE(satuarday, 0)', 'COALESCE(sunday, 0)'] ;

    let dayOfWeek = getDay(date) ;

    if(dayOfWeek === 0){
        dayOfWeek = 6 ;
    }else{
        dayOfWeek -= 1
    }
    const firstWeekColumnNames = columnNames.slice(dayOfWeek).join('+');


    // date.setMonth(date.getMonth() + 1) ;
    // date.setDate(0) ;
    
    date = new Date(endDate) ;

    const dateEndWeekNumber = getWeek(date, {weekStartsOn:1, firstWeekContainsDate:2})
    const endWeekNumberFormat = `${year}-W${dateEndWeekNumber}`

    const dateEndPreviousWeekDate = previousSunday(date) ;
    const dateEndtPreviousWeekFormat = format(dateEndPreviousWeekDate, 'yyyy-MM-dd') ;

    dayOfWeek = getDay(date) ;

    if(dayOfWeek === 0){
        dayOfWeek = 7 ;
    }

    const lastWeekColumnNames = columnNames.slice(0, dayOfWeek).join('+') ;

    // console.log(firstWeekNumberFormat)
    // console.log(secondWeekFirstDayFormat)
    // console.log(firstWeekColumnNames)

    // console.log(endWeekNumberFormat)
    // console.log(monthEndtPreviousWeekFormat)
    // console.log(lastWeekColumnNames)

    const firstWeekSelectQuery = `
        SELECT TIMESHEET_PROJECT.project_id AS projectId, PROJECT.project_name AS projectName, PROJECT.type AS projectType,CUSTOMER.name AS customerName,POSITION.position_name AS positionName,PROJECT.cost_type AS costType,
        SUM(${firstWeekColumnNames}) AS total,
        SUM((${firstWeekColumnNames}) * COALESCE(TIMESHEET_PROJECT.rate,0)/8) AS cost,TIMESHEET_PROJECT.rate, TIMESHEET_PROJECT.currency
        FROM TIMESHEET JOIN EMPLOYEE ON EMPLOYEE.id = TIMESHEET.employee_id JOIN TIMESHEET_PROJECT ON TIMESHEET_PROJECT.timesheet_id = TIMESHEET.id JOIN PROJECT ON PROJECT.id = TIMESHEET_PROJECT.project_id LEFT JOIN CUSTOMER ON CUSTOMER.id = PROJECT.customer_id
        LEFT JOIN POSITION ON TIMESHEET_PROJECT.role_id = POSITION.id
        WHERE TIMESHEET.week LIKE '%${firstWeekNumberFormat}%' AND TIMESHEET.employee_id LIKE '%${employeeId}%'
        GROUP BY projectId, rate, positionName
    `

    const lastWeekSelectQuery = `
        SELECT TIMESHEET_PROJECT.project_id AS projectId, PROJECT.project_name AS projectName, PROJECT.type AS projectType,CUSTOMER.name AS customerName,POSITION.position_name AS positionName,PROJECT.cost_type AS costType,
        SUM(${lastWeekColumnNames}) AS total,
        SUM((${lastWeekColumnNames}) * COALESCE(TIMESHEET_PROJECT.rate,0)/8) AS cost,TIMESHEET_PROJECT.rate, TIMESHEET_PROJECT.currency
        FROM TIMESHEET JOIN EMPLOYEE ON EMPLOYEE.id = TIMESHEET.employee_id JOIN TIMESHEET_PROJECT ON TIMESHEET_PROJECT.timesheet_id = TIMESHEET.id JOIN PROJECT ON PROJECT.id = TIMESHEET_PROJECT.project_id LEFT JOIN CUSTOMER ON CUSTOMER.id = PROJECT.customer_id
        LEFT JOIN POSITION ON TIMESHEET_PROJECT.role_id = POSITION.id
        WHERE TIMESHEET.week LIKE '%${endWeekNumberFormat}%' AND TIMESHEET.employee_id LIKE '%${employeeId}%'
        GROUP BY projectId, rate, positionName
    `

    const middleWeeksSelectQuery = `
        SELECT TIMESHEET_PROJECT.project_id AS projectId, PROJECT.project_name AS projectName, PROJECT.type AS projectType,CUSTOMER.name AS customerName,POSITION.position_name AS positionName,PROJECT.cost_type AS costType,
        SUM(COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(wednesday,0)+COALESCE(thursday,0)+COALESCE(friday,0)+COALESCE(satuarday,0)+COALESCE(sunday,0)) AS total, 
        SUM((COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(wednesday,0)+COALESCE(thursday,0)+COALESCE(friday,0)+COALESCE(satuarday,0)+COALESCE(sunday,0)) * COALESCE(TIMESHEET_PROJECT.rate,0)/8) AS cost,TIMESHEET_PROJECT.rate, TIMESHEET_PROJECT.currency

        FROM TIMESHEET JOIN EMPLOYEE ON EMPLOYEE.id = TIMESHEET.employee_id JOIN TIMESHEET_PROJECT ON TIMESHEET_PROJECT.timesheet_id = TIMESHEET.id JOIN PROJECT ON project.id = TIMESHEET_PROJECT.project_id LEFT JOIN CUSTOMER ON CUSTOMER.id = PROJECT.customer_id
        LEFT JOIN POSITION ON TIMESHEET_PROJECT.role_id = POSITION.id
        WHERE TIMESHEET.id IN (SELECT TIMESHEET.id AS id 
            FROM TIMESHEET
            WHERE TIMESHEET.employee_id LIKE '%${employeeId}%' AND TIMESHEET.start_date >= '${secondWeekFirstDayFormat}' AND TIMESHEET.end_date <= '${dateEndtPreviousWeekFormat}')
        GROUP BY projectId, rate, positionName
    `

    const selectMonthQuery = `
            WITH FirstWeek AS (
                ${firstWeekSelectQuery}
            ),
            MiddleWeek AS (
                ${middleWeeksSelectQuery}
            ),
            LastWeek AS (
                ${lastWeekSelectQuery}
            )
            SELECT projectId, projectName, SUM(total) AS total, SUM(cost) AS cost, rate, currency, projectType, customerName, positionName,costType
            FROM (
                SELECT * FROM FirstWeek
                UNION ALL
                SELECT * FROM MiddleWeek
                UNION ALL
                SELECT * FROM LastWeek
            ) AS CombineQuery
            GROUP BY projectId, rate, positionName ;
    `

    const data = await db.all(selectMonthQuery)
    response.send(data) ;

})



app.get('/timesheet/employee/:employeeId/weekly_export/:weekValue',authenticateToken,isAdminstartor, async (request, response) => {
    const {employeeId,  weekValue} = request.params ;
    
    
    const selectTimeSheetQuery = `
        SELECT TIMESHEET_PROJECT.project_id AS projectId, PROJECT.project_name AS projectName, PROJECT.type AS projectType, CUSTOMER.name AS customerName,POSITION.position_name AS positionName,PROJECT.cost_type AS costType,
        (COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(wednesday,0)+COALESCE(thursday,0)+COALESCE(friday,0)+COALESCE(satuarday,0)+COALESCE(sunday,0)) AS total, 
        ((COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(wednesday,0)+COALESCE(thursday,0)+COALESCE(friday,0)+COALESCE(satuarday,0)+COALESCE(sunday,0)) * COALESCE(TIMESHEET_PROJECT.rate,0)/8) AS cost, TIMESHEET_PROJECT.rate AS rate, TIMESHEET_PROJECT.currency AS currency

        FROM TIMESHEET JOIN EMPLOYEE ON EMPLOYEE.id = TIMESHEET.employee_id JOIN TIMESHEET_PROJECT ON TIMESHEET_PROJECT.timesheet_id = TIMESHEET.id JOIN PROJECT ON project.id = TIMESHEET_PROJECT.project_id LEFT JOIN CUSTOMER ON CUSTOMER.id = PROJECT.customer_id
        LEFT JOIN POSITION ON TIMESHEET_PROJECT.role_id = POSITION.id
        WHERE TIMESHEET.employee_id LIKE '%${employeeId}%' AND TIMESHEET.week LIKE '%${weekValue}%'
        GROUP BY projectId, rate, positionName;
        `

    const data = await db.all(selectTimeSheetQuery)
 
    response.send(data) ;
    
})



app.get("/employee/:employeeId",authenticateToken,isAdminstartor, async (request, response) => {
    const {employeeId} = request.params ;

    const selectEmployeeQuery = `
        SELECT EMPLOYEE.id AS employeeId, name AS employeeName, official_mail AS employeeEmail, is_admin AS isAdmin , POSITION.position_name AS position
        FROM EMPLOYEE JOIN POSITION ON EMPLOYEE.position_id = POSITION.id
        WHERE EMPLOYEE.id = ? ;
    `

    try{
        const dbData = await db.get(selectEmployeeQuery, [employeeId])
        if(dbData === undefined){
            response.status(404)
            response.send({msg:"Employee Id Not Found"})
        }else{
            response.send(dbData) ;
        }
    }
    catch(error){
        console.log(error)
    }
      
})

app.get("/employees",authenticateToken,isAdminstartor, async (request, response) => {
    const  {employeeId = "", employeeName = ""} = request.query ;

    const selectEmployeesQuery = `
        SELECT EMPLOYEE.id AS employeeId, EMPLOYEE.name AS employeeName, EMPLOYEE.official_mail AS employeeEmail, EMPLOYEE.is_admin AS isAdmin, POSITION.position_name AS positionName
        FROM EMPLOYEE JOIN POSITION ON EMPLOYEE.position_id = POSITION.id
        WHERE EMPLOYEE.id LIKE '%${employeeId}%' AND EMPLOYEE.name LIKE '%${employeeName}%';
    `

    const dbData = await db.all(selectEmployeesQuery) ;

    response.send(dbData) ;
})

app.get("/projects",authenticateToken,isAdminstartor, async (request, response) => {
    const {projectName = ""} = request.query ;

    const selectProjectsQuery = `
        SELECT CURRENT_PROJECT.id as projectId, CURRENT_PROJECT.project_name AS projectName, type AS projectType, start_date AS startDate, end_date AS endDate, description,cost_type AS costType, cost, currency, CUSTOMER.name AS customer
        FROM CURRENT_PROJECT LEFT JOIN CUSTOMER ON CURRENT_PROJECT.customer_id = CUSTOMER.id
        WHERE project_name LIKE '%${projectName}%';
    `

    const dbData = await db.all(selectProjectsQuery) ;

    response.send(dbData) ;
})

app.put("/project/employee/save/:employeeId",authenticateToken,isAdminstartor, async (request, response) => {
    const {employeeId} = request.params ;
    const {projectId,startDate, endDate, roleId, rate, currency} = request.body ;

    const addProjectToEmployeeQuery = `
        INSERT INTO EMPLOYEE_PROJECT(
            employee_id, project_id, role_id, rate,currency, start_date, end_date
        )
        VALUES (
            ?, ?, ?, ?, ?, ?, ?
        ) ;
    ` 

    try{
        await db.run(addProjectToEmployeeQuery, [
            employeeId, projectId, roleId, rate, currency, startDate, endDate
        ])

        response.send({message:"project added successfull"}) ;
    }
    catch(error){
        response.status(404) ;
        response.send("unknow error occured") ;
    }
    
})

app.delete('/project/employee/remove/:employeeId',authenticateToken,isAdminstartor, async (request, response) => {
    const {employeeId} = request.params ;
    const {projectId} = request.body ;

    const deleteEmployeeProjectQuery = `
        DELETE FROM EMPLOYEE_PROJECT
        WHERE employee_id = ${employeeId} AND project_id = ${projectId} ;
    `

    try{
        await db.run(deleteEmployeeProjectQuery)
        response.send({message:"Project Removed Successfull"})
    }
    catch(error){
        response.status(404) ;
        response.send({message:"unknow error occured"}) ;
    }
})

app.put('/project/employee/update/:employeeId',authenticateToken,isAdminstartor, async (request, response) => {
    const {employeeId} = request.params ;
    
    const {projectId,startDate, endDate, roleId, rate, currency} = request.body ;

    const updateProjectOfEmployeeQuery = `
        UPDATE EMPLOYEE_PROJECT
        SET start_date = ? , end_date = ? , role_id = ?, rate = ?, currency = ?
        WHERE project_id = ${projectId} AND employee_id = ${employeeId} ;
    ` 

    try{
        await db.run(updateProjectOfEmployeeQuery, [
            startDate, endDate, roleId, rate, currency 
        ])

        response.send({message:"project updated successfull"}) ;
    }
    catch(error){
        response.status(404) ;
        response.send("unknow error occured") ;
    }

})


// app.put("/projects/save/:employeeId", async (request, response) => {
//     const {employeeId} = request.params ;

//     const {projectsList} = request.body ;
//     console.log(projectsList)

//     const deleteProjectsQuery = `
//         DELETE FROM EMPLOYEE_PROJECT
//         WHERE employee_id = '${employeeId}';
//     `

//     await db.run(deleteProjectsQuery)

//     for(let project of projectsList){
//         const addProjectToEmployeeQuery = `
//         INSERT INTO EMPLOYEE_PROJECT(
//             employee_id, project_id
//         )
//         VALUES (
//             ${employeeId}, ${project.projectId}
//         )
//     `
//     await db.run(addProjectToEmployeeQuery)
//     }

//     response.send({message:"projects added successfull"})
    
// })

app.delete("/project/delete/:projectId",authenticateToken,isAdminstartor, async (request, response) => {
    const {projectId} = request.params 

    const deleteProjectQuery = `
        DELETE FROM CURRENT_PROJECT
        WHERE id=${projectId};
    `

    try{
        await db.run(deleteProjectQuery) ;
        response.send({message:"project removed successfull"}) ;
    }
    catch(error){
        console.log(error)
    }
    
})

app.post('/project/create/',authenticateToken,isAdminstartor, async (request, response) => {

    const {projectName, projectType,customerId,costType, cost,currency, description, startDate, endDate } = request.body ;
     

    const createProjectQuery = `
        INSERT INTO PROJECT(
            project_name, type, start_date, end_date, description, customer_id, cost, currency, cost_type
        )
        VALUES(
            ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
    `

    const createCurrentProjectQuery = `
            INSERT INTO CURRENT_PROJECT(
                project_name, type, start_date, end_date, description, customer_id, cost, currency, cost_type
            )
            VALUES(
                ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
    `
    
    try{
        await db.run(createProjectQuery, [
            projectName, projectType, 
            startDate, endDate, 
            description, customerId, cost,currency,costType
        ]) ;

        const dbResponse = await db.run(createCurrentProjectQuery, [
            projectName, projectType, 
            startDate, endDate, 
            description, customerId, cost,currency,costType
        ]) ;

        response.send({projectId:dbResponse.lastID}) ;
    }
    catch(error){
        console.log(error)
    }
});


app.get("/customers",authenticateToken,isAdminstartor, async (request, response) => {
    const {name = ""} = request.query ;

    const selectCustomersQuery = `
        SELECT id as customerId, name AS name, email,contact_person AS contactPerson, contact_number AS contactNumber, address
        FROM CUSTOMER
        WHERE name LIKE '%${name}%';
    `

    const dbData = await db.all(selectCustomersQuery) ;

    response.send(dbData) ;
})

app.post('/customer/create/',authenticateToken,isAdminstartor, async (request, response) => {

    const {
        name, contactPerson, contactNumber, email, address
    } = request.body ;

     

    const createCustomerQuery = `
        INSERT INTO CUSTOMER(
            name, contact_number, email, address, contact_person
        )
        VALUES(
            ?, ?, ?, ?, ?
        )
    `
    
    try{
        const dbResponse = await db.run(createCustomerQuery, [
            name, contactNumber, email, address, contactPerson
        ]) ;

        response.send({customerId:dbResponse.lastID}) ;
    }
    catch(error){
        console.log(error)
    }
});


app.delete("/customer/delete/:customerId",authenticateToken,isAdminstartor, async (request, response) => {
    const {customerId} = request.params 

    const deleteCustomerQuery = `
        DELETE FROM CUSTOMER
        WHERE id=${customerId};
    `

    try{
        await db.run(deleteCustomerQuery) ;
        response.send({message:"customer removed successfull"}) ;
    }
    catch(error){
        console.log(error)
    }
    
})


app.post("/employee/create",authenticateToken,isAdminstartor, async (request, response) => {

    const {
        employeeName,
        contactNumber,
        personalMail,
        officialMail,
        doj,
        positionId,
        departmentId,
        address,
        reportingManagerId
    } = request.body ;

    const hashedPassword = await bcrypt.hash('user@123', 10) ;

    const createEmployeeQuery = `
        INSERT INTO EMPLOYEE(
            name, contact_number, personal_mail,official_mail, doj, position_id, department_id,address,password, reporting_manager_id
        )
        VALUES(
            ?, ?, ?, ?, ?, ?, ?,? , ?, ?
        )
    `
    
    try{
        const dbResponse = await db.run(createEmployeeQuery, [
            employeeName,
            contactNumber,
            personalMail,
            officialMail,
            doj,
            positionId,
            departmentId,
            address,
            hashedPassword,
            reportingManagerId
        ]) ;

        response.send({employeeId:dbResponse.lastID}) ;
    }
    catch(error){
        console.log(error)
    }
    
})

app.delete("/employee/delete/:employeeId",authenticateToken,isAdminstartor, async (request, response) => {

    const {employeeId} = request.params ;

    const deleteEmployeeQuery = `
        DELETE FROM EMPLOYEE
        WHERE id = ?
    `
    
    try{
        await db.run(deleteEmployeeQuery, [employeeId])

        response.send({message:"Employee deleted"}) ;
    }
    catch(error){
        console.log(error)
    }
    
})


app.get('/positions',authenticateToken,isAdminstartor, async (request, response) => {
    
    const selectPositionQuery = `
        SELECT id AS positionId, position_name AS positionName
        FROM POSITION ;
    `

    const dbData = await db.all(selectPositionQuery) ;

    response.send(dbData) ;
})


app.get('/departments',authenticateToken,isAdminstartor, async (request, response) => {

    const selectDepartmentsQuery = `
        SELECT id AS departmentId, name AS departmentName
        FROM DEPARTMENT ;
    `

    const dbData = await db.all(selectDepartmentsQuery) ;

    response.send(dbData) ;
})


app.get('/reporting_manager/employees/pending_timesheets/:reportingManagerId', async (request, response) => {
    
    const {reportingManagerId} = request.params ;

    
    const {timesheet_id = "",employee_id="",employee_name="",log_hours="", start_date, end_date,status=""} = request.query;   
    
    
    const selectPendingTimeSheetsQuery = `
    SELECT TIMESHEET.id AS timeSheetId, TIMESHEET.employee_id AS employeeId , EMPLOYEE.name AS employeeName , TIMESHEET.week AS week, TIMESHEET.status AS status, TIMESHEET.start_date AS startDate,TIMESHEET.end_date AS endDate, SUM(COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(thursday, 0)+COALESCE(friday, 0)+COALESCE(wednesday, 0)+COALESCE(satuarday, 0) +COALESCE(sunday, 0)) AS logHours, 
    EMPLOYEE.official_mail AS officialMail, EMPLOYEE.reporting_manager_id AS reportingManagerId
    FROM 
    TIMESHEET JOIN TIMESHEET_PROJECT
        ON TIMESHEET.id = TIMESHEET_PROJECT.timesheet_id JOIN EMPLOYEE ON TIMESHEET.employee_Id = EMPLOYEE.id  
    WHERE TIMESHEET.id LIKE '%${timesheet_id}%' 
            AND TIMESHEET.start_date >= '${start_date}' 
            AND TIMESHEET.end_date <= '${end_date}'
            AND EMPLOYEE.id LIKE '%${employee_id}%' 
            AND EMPLOYEE.name LIKE '%${employee_name}%'
            AND TIMESHEET.status = 'submited'
            AND EMPLOYEE.reporting_manager_id = ${reportingManagerId}
    GROUP BY timesheet_id
    HAVING logHours LIKE '%${log_hours}%' 
    ORDER BY employeeId ;
    `

    const data = await db.all(selectPendingTimeSheetsQuery) ;
    response.send(data)
})

app.get("/reporting_manager/employees/:reportingMangerId", async (request, response) => {

    const {reportingMangerId} = request.params ;
    
    const selectEmployeesQuery =  `
        SELECT EMPLOYEE.id AS employeeId, EMPLOYEE.name AS employeeName
        FROM EMPLOYEE
        WHERE EMPLOYEE.reporting_manager_id = ? ;
    `

    try{
        const data = await db.all(selectEmployeesQuery, [reportingMangerId]) ;
        response.send(data)
    }
    catch(error){
        console.log(error) ;
    }
})